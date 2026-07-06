import "server-only"

import { Client, WorkflowAbort, type WorkflowContext } from "@upstash/workflow"
import type { KnowledgeSyncParsedDocumentResponse } from "@ontos-ai/knowhere-sdk"

import { makeKnowhereClientWithParsedStorage } from "@/integrations/knowhere"
import { logger } from "@/lib/logger"
import {
  getParsedSyncWorkflowRunId,
  type ParsedSyncPayload,
} from "./parsed-document-sync-scheduler"
import { parsedDocumentSyncCapacityGuard } from "./parsed-document-sync-capacity"
import { sourceWorkflowRuntime } from "./workflow-runtime"

type ParsedSyncWorkflowContext = Pick<
  WorkflowContext<ParsedSyncPayload>,
  "run" | "url"
>

type NormalizedParsedSyncPayload = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly documentId: string
  readonly apiKey: string
  readonly revisionKey?: string
  readonly segmentIndex: number
}

type ContinuationTriggerInput = {
  readonly url: string
  readonly payload: ParsedSyncPayload
  readonly workflowRunId: string
  readonly delaySeconds?: number
}

type SyncLeaseReleaseReason = "completed" | "incomplete" | "failed"

// Sync steps per workflow segment. Each `syncParsedDocument` call is bounded by
// the SDK limits (pages + deadline); this caps how many bounded steps we run in
// one serverless invocation before handing off to a fresh continuation.
const maxSyncStepsPerSegment = 4

let triggerContinuation: typeof triggerParsedSyncContinuation =
  triggerParsedSyncContinuation

function normalizeParsedSyncPayload(
  payload: ParsedSyncPayload,
): NormalizedParsedSyncPayload {
  return {
    workspaceId: payload.workspaceId,
    sourceId: payload.sourceId,
    documentId: payload.documentId,
    apiKey: payload.apiKey,
    revisionKey: payload.revisionKey,
    segmentIndex:
      typeof payload.segmentIndex === "number" &&
      Number.isInteger(payload.segmentIndex) &&
      payload.segmentIndex >= 0
        ? payload.segmentIndex
        : 0,
  }
}

async function runParsedSyncWorkflow(input: {
  readonly context: ParsedSyncWorkflowContext
  readonly payload: NormalizedParsedSyncPayload
}): Promise<void> {
  const { context, payload } = input
  const { workspaceId, sourceId, documentId, apiKey } = payload
  const { knowledge } = makeKnowhereClientWithParsedStorage(apiKey, {
    workspaceId,
  })

  let revisionKey = payload.revisionKey
  let completed = false
  let releaseReason: SyncLeaseReleaseReason = "incomplete"
  let shouldReleaseLease = true

  const capacity = await context.run(
    `acquire-sync-capacity-${payload.segmentIndex}`,
    async () =>
      parsedDocumentSyncCapacityGuard.acquire({
        workspaceId,
        sourceId,
        documentId,
        revisionKey,
      }),
  )
  if (capacity.kind === "source-missing") return
  if (capacity.kind === "capacity-full") {
    await context.run(
      `record-capacity-wait-${payload.segmentIndex}`,
      async () =>
        sourceWorkflowRuntime.updateSyncStatus(workspaceId, sourceId, {
          revisionKey,
          syncStatus: "pending",
          syncError: null,
        }),
    )
    const nextSegmentIndex = payload.segmentIndex + 1
    await context.run(
      `trigger-sync-capacity-retry-${nextSegmentIndex}`,
      async () =>
        triggerContinuation({
          url: context.url,
          payload: {
            workspaceId,
            sourceId,
            documentId,
            apiKey,
            revisionKey,
            segmentIndex: nextSegmentIndex,
          },
          workflowRunId: getParsedSyncWorkflowRunId({
            documentId,
            revisionKey: revisionKey ?? "initial",
            segmentIndex: nextSegmentIndex,
          }),
          delaySeconds: capacity.waitSeconds,
        }),
    )
    logger.info("parsed-sync: capacity full; retry scheduled", {
      sourceId,
      documentId,
      reason: capacity.reason,
      waitSeconds: capacity.waitSeconds,
      activeCounts: capacity.activeCounts,
    })
    return
  }

  try {
    for (let step = 0; step < maxSyncStepsPerSegment; step++) {
      const result: KnowledgeSyncParsedDocumentResponse = await context.run(
        `sync-${payload.segmentIndex}-${step}`,
        async () =>
          knowledge.syncParsedDocument({
            documentId,
            ...(revisionKey ? { revisionKey } : {}),
          }),
      )
      revisionKey = result.revisionKey

      await context.run(`record-progress-${payload.segmentIndex}-${step}`, () =>
        sourceWorkflowRuntime.updateSyncStatus(workspaceId, sourceId, {
          revisionKey,
          syncStatus: result.completed ? "completed" : "running",
        }),
      )

      if (result.completed) {
        completed = true
        releaseReason = "completed"
        break
      }
    }

    if (!completed) {
      const nextSegmentIndex = payload.segmentIndex + 1
      await context.run(
        `trigger-sync-continuation-${nextSegmentIndex}`,
        async () =>
          triggerContinuation({
            url: context.url,
            payload: {
              workspaceId,
              sourceId,
              documentId,
              apiKey,
              revisionKey,
              segmentIndex: nextSegmentIndex,
            },
            workflowRunId: getParsedSyncWorkflowRunId({
              documentId,
              revisionKey: revisionKey ?? "initial",
              segmentIndex: nextSegmentIndex,
            }),
          }),
      )
      logger.info("parsed-sync: continuation triggered", {
        sourceId,
        documentId,
        segmentIndex: nextSegmentIndex,
      })
      return
    }
  } catch (error) {
    if (isWorkflowControlAbort(error)) {
      shouldReleaseLease = false
      throw error
    }
    releaseReason = "failed"
    throw error
  } finally {
    if (shouldReleaseLease) {
      await context.run(`release-sync-capacity-${payload.segmentIndex}`, async () =>
        releaseCapacityLease({
          leaseToken: capacity.leaseToken,
          releaseReason,
          sourceId,
          documentId,
        }),
      )
    }
  }

  logger.info("parsed-sync: parsed document sync finished", {
    sourceId,
    documentId,
    revisionKey,
  })
}

async function releaseCapacityLease(input: {
  readonly leaseToken: string
  readonly releaseReason: SyncLeaseReleaseReason
  readonly sourceId: string
  readonly documentId: string
}): Promise<void> {
  try {
    await parsedDocumentSyncCapacityGuard.release({
      leaseToken: input.leaseToken,
      releaseReason: input.releaseReason,
    })
  } catch (error) {
    logger.error("parsed-sync: failed to release capacity lease", {
      sourceId: input.sourceId,
      documentId: input.documentId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function triggerParsedSyncContinuation(
  input: ContinuationTriggerInput,
): Promise<void> {
  const token = process.env.QSTASH_TOKEN
  if (!token) {
    throw new Error("QSTASH_TOKEN is required to continue parsed document sync.")
  }

  await new Client({ token }).trigger({
    url: input.url,
    body: input.payload,
    workflowRunId: input.workflowRunId,
    retries: 3,
    delay: input.delaySeconds,
  })
}

async function markSyncFailedAfterWorkflowFailure(
  payload: ParsedSyncPayload,
  failResponse: string,
): Promise<void> {
  const normalized = normalizeParsedSyncPayload(payload)
  const reason = getSafeFailureReason(failResponse)

  // Parsed storage is a cache/read model. Exhausted sync failure is recorded for
  // observability, but the source remains ready and SDK reads can fall back to
  // Knowhere remote.
  await sourceWorkflowRuntime.updateSyncStatus(
    normalized.workspaceId,
    normalized.sourceId,
    {
      revisionKey: normalized.revisionKey,
      syncStatus: "failed",
      syncError: reason,
    },
  )

  logger.error("parsed-sync: marked sync failed after workflow failure", {
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    documentId: normalized.documentId,
    segmentIndex: normalized.segmentIndex,
  })
}

function getSafeFailureReason(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length === 0) return "retry attempts were exhausted."
  return normalized.slice(0, 500)
}

function setContinuationTriggerForTesting(
  trigger: typeof triggerParsedSyncContinuation,
): () => void {
  const previous = triggerContinuation
  triggerContinuation = trigger
  return () => {
    triggerContinuation = previous
  }
}

function isWorkflowControlAbort(error: unknown): boolean {
  return (
    (error instanceof WorkflowAbort && error.constructor === WorkflowAbort) ||
    (error instanceof Error && error.name === "WorkflowAbort")
  )
}

export const parsedSyncRouteWorkflow = {
  markSyncFailedAfterWorkflowFailure,
  normalizeParsedSyncPayload,
  runParsedSyncWorkflow,
  setContinuationTriggerForTesting,
}
