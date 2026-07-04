import "server-only"

import { Client, type WorkflowContext } from "@upstash/workflow"
import type { KnowledgeSyncParsedDocumentResponse } from "@ontos-ai/knowhere-sdk"

import { makeKnowhereClientWithParsedStorage } from "@/integrations/knowhere"
import { logger } from "@/lib/logger"
import {
  getParsedSyncWorkflowRunId,
  type ParsedSyncPayload,
} from "./parsed-document-sync-scheduler"
import { markSourceReadyAfterReconciliation } from "./source-reconcile-workflow"
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
}

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

  // A parsing source is only readied once its parsed snapshot is fully synced.
  // For an already-ready source (read-miss backfill) markReady is a no-op guard.
  const ready = await context.run("source-ready", async () =>
    markSourceReadyAfterReconciliation({
      workspaceId,
      sourceId,
      documentId,
    }),
  )
  logger.info("parsed-sync: parsed document sync finished", {
    sourceId,
    documentId,
    revisionKey,
    status: ready.status,
  })
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
  })
}

async function markSyncFailedAfterWorkflowFailure(
  payload: ParsedSyncPayload,
  failResponse: string,
): Promise<void> {
  const normalized = normalizeParsedSyncPayload(payload)
  const reason = getSafeFailureReason(failResponse)

  // Record the storage-sync failure. A source still `parsing` is failed with
  // failure_stage=storage_sync so a retry resumes sync without reparsing; an
  // already-ready source is left ready (it still serves via remote fallback),
  // only its sync_status is marked failed for observability.
  await sourceWorkflowRuntime.updateSyncStatus(
    normalized.workspaceId,
    normalized.sourceId,
    {
      revisionKey: normalized.revisionKey,
      syncStatus: "failed",
      syncError: reason,
    },
  )

  const source = await sourceWorkflowRuntime.findInWorkspace(
    normalized.workspaceId,
    normalized.sourceId,
  )
  if (source?.status === "parsing") {
    await sourceWorkflowRuntime.markFailed(
      normalized.workspaceId,
      normalized.sourceId,
      `Parsed document storage sync failed: ${reason}`,
      "parsing",
      "storage_sync",
    )
  }

  logger.error("parsed-sync: marked sync failed after workflow failure", {
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    documentId: normalized.documentId,
    segmentIndex: normalized.segmentIndex,
    sourceStatus: source?.status,
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

export const parsedSyncRouteWorkflow = {
  markSyncFailedAfterWorkflowFailure,
  normalizeParsedSyncPayload,
  runParsedSyncWorkflow,
  setContinuationTriggerForTesting,
}
