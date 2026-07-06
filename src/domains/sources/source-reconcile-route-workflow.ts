import "server-only"

import { Client, type WorkflowContext } from "@upstash/workflow"

import {
  markSourceReadyAfterReconciliation,
  pollSourceReconciliation,
} from "@/domains/sources/source-reconcile-workflow"
import { makeKnowhereClientWithParsedStorage } from "@/integrations/knowhere"
import { logger } from "@/lib/logger"
import { enqueueParsedDocumentSync } from "./parsed-document-sync-scheduler"
import { sourceWorkflowRuntime } from "./workflow-runtime"

type ReconcilePayload = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly apiKey: string
  readonly phase?: ReconcilePhase
  readonly segmentIndex?: number
}

type ReconcilePhase = "poll-and-ready" | "poll-and-mirror" | "asset-batches"

type NormalizedReconcilePayload = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly apiKey: string
  readonly phase: "poll-and-ready"
  readonly segmentIndex: number
}

type ReconcileWorkflowContext = Pick<
  WorkflowContext<ReconcilePayload>,
  "run" | "sleep" | "url"
>

type ContinuationTriggerInput = {
  readonly url: string
  readonly payload: ReconcilePayload
  readonly workflowRunId: string
}

type RevisionKeyClient = {
  readonly documents: {
    readonly listChunks: (
      documentId: string,
      params: {
        readonly page: number
        readonly pageSize: number
        readonly includeAssetUrls: boolean
      },
    ) => Promise<{
      readonly jobResultId?: string | null
      readonly jobId?: string | null
    }>
  }
}

const maxPollAttempts = 25
const initialDelaySeconds = 3
const maxDelaySeconds = 30

let triggerContinuation: typeof triggerReconcileContinuation =
  triggerReconcileContinuation

async function runPollAndMirrorWorkflow(input: {
  readonly context: ReconcileWorkflowContext
  readonly payload: NormalizedReconcilePayload
}): Promise<void> {
  const { context, payload } = input
  const { workspaceId, sourceId, apiKey } = payload
  const { client } = makeKnowhereClientWithParsedStorage(apiKey, {
    workspaceId,
  })
  let delay = initialDelaySeconds
  let completedJob: {
    readonly jobId: string
    readonly documentId: string
  } | null = null

  for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
    const poll = await context.run(`poll-${attempt}`, async () => {
      return pollSourceReconciliation({
        workspaceId,
        sourceId,
        client,
      })
    })

    if (poll.kind === "ready-to-prepare") {
      completedJob = {
        jobId: poll.jobId,
        documentId: poll.documentId,
      }
      logger.info("workflow: source parse completed; readying source", {
        sourceId,
        jobId: poll.jobId,
        attempts: attempt + 1,
      })
      break
    }

    if (poll.kind === "resolved") {
      logger.info("workflow: source resolved", {
        sourceId,
        status: poll.status,
        attempts: attempt + 1,
      })
      return
    }

    await context.sleep(`wait-${attempt}`, delay)
    delay = Math.min(Math.round(delay * 1.5), maxDelaySeconds)
  }

  const jobToPrepare = completedJob
  if (!jobToPrepare) {
    const nextSegmentIndex = payload.segmentIndex + 1
    await context.run(`trigger-poll-continuation-${nextSegmentIndex}`, async () =>
      triggerContinuation({
        url: context.url,
        payload: {
          workspaceId,
          sourceId,
          apiKey,
          phase: "poll-and-ready",
          segmentIndex: nextSegmentIndex,
        },
        workflowRunId: getPollWorkflowRunId(sourceId, nextSegmentIndex),
      }),
    )
    logger.info("workflow: poll continuation triggered", {
      sourceId,
      maxAttempts: maxPollAttempts,
      segmentIndex: nextSegmentIndex,
    })
    return
  }

  const ready = await context.run("source-ready", async () =>
    markSourceReadyAfterReconciliation({
      workspaceId,
      sourceId,
      documentId: jobToPrepare.documentId,
    }),
  )
  if (ready.status === "gone") return

  const revisionKey = await context.run("resolve-revision-key", async () =>
    resolveParsedRevisionKey({
      client,
      sourceId,
      documentId: jobToPrepare.documentId,
      fallbackRevisionKey: jobToPrepare.jobId,
    }),
  )

  await context.run("record-source-revision-key", async () =>
    sourceWorkflowRuntime.updateRevisionKey(workspaceId, sourceId, revisionKey),
  )
  await context.run("record-sync-pending", async () =>
    sourceWorkflowRuntime.updateSyncStatus(workspaceId, sourceId, {
      revisionKey,
      syncStatus: "pending",
      syncError: null,
    }),
  )
  const enqueueResult = await context.run("enqueue-parsed-sync", async () =>
    enqueueParsedSyncBestEffort({
      workspaceId,
      sourceId,
      documentId: jobToPrepare.documentId,
      apiKey,
      revisionKey,
    }),
  )

  logger.info("workflow: source parse reconciliation finished", {
    sourceId,
    jobId: jobToPrepare.jobId,
    revisionKey,
    status: ready.status,
    parsedSyncEnqueued: enqueueResult.enqueued,
  })
}

async function resolveParsedRevisionKey(input: {
  readonly client: RevisionKeyClient
  readonly sourceId: string
  readonly documentId: string
  readonly fallbackRevisionKey: string
}): Promise<string> {
  try {
    const firstPage = await input.client.documents.listChunks(input.documentId, {
      page: 1,
      pageSize: 1,
      includeAssetUrls: false,
    })
    return firstPage.jobResultId ?? firstPage.jobId ?? input.fallbackRevisionKey
  } catch (error) {
    logger.warn("workflow: failed to resolve parsed revision key", {
      sourceId: input.sourceId,
      documentId: input.documentId,
      fallbackRevisionKey: input.fallbackRevisionKey,
      error: getErrorMessage(error),
    })
    return input.fallbackRevisionKey
  }
}

async function enqueueParsedSyncBestEffort(input: {
  readonly workspaceId: string
  readonly sourceId: string
  readonly documentId: string
  readonly apiKey: string
  readonly revisionKey: string
}): Promise<{ readonly enqueued: boolean }> {
  try {
    await enqueueParsedDocumentSync(input)
    return { enqueued: true }
  } catch (error) {
    logger.error("workflow: failed to enqueue parsed storage sync", {
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      documentId: input.documentId,
      revisionKey: input.revisionKey,
      error: getErrorMessage(error),
    })
    return { enqueued: false }
  }
}

function normalizeReconcilePayload(
  payload: ReconcilePayload,
): NormalizedReconcilePayload {
  return {
    workspaceId: payload.workspaceId,
    sourceId: payload.sourceId,
    apiKey: payload.apiKey,
    phase: "poll-and-ready",
    segmentIndex:
      typeof payload.segmentIndex === "number" &&
      Number.isInteger(payload.segmentIndex) &&
      payload.segmentIndex >= 0
        ? payload.segmentIndex
        : 0,
  }
}

async function triggerReconcileContinuation(
  input: ContinuationTriggerInput,
): Promise<void> {
  const token = process.env.QSTASH_TOKEN
  if (!token) {
    throw new Error("QSTASH_TOKEN is required to continue source reconciliation.")
  }

  await new Client({ token }).trigger({
    url: input.url,
    body: input.payload,
    workflowRunId: input.workflowRunId,
    retries: 3,
  })
}

function getPollWorkflowRunId(sourceId: string, segmentIndex: number): string {
  return `${sourceId}-poll-${segmentIndex}`
}

function setContinuationTriggerForTesting(
  trigger: typeof triggerReconcileContinuation,
): () => void {
  const previous = triggerContinuation
  triggerContinuation = trigger
  return () => {
    triggerContinuation = previous
  }
}

async function markSourceFailedAfterWorkflowFailure(
  payload: ReconcilePayload,
  failResponse: string,
): Promise<void> {
  const normalized = normalizeReconcilePayload(payload)
  const reason = `Source reconciliation workflow failed: ${getSafeFailureReason(
    failResponse,
  )}`
  const source = await sourceWorkflowRuntime.markFailed(
    normalized.workspaceId,
    normalized.sourceId,
    reason,
    "parsing",
  )
  logger.error("workflow: marked source failed after workflow failure", {
    sourceId: normalized.sourceId,
    workspaceId: normalized.workspaceId,
    phase: normalized.phase,
    segmentIndex: normalized.segmentIndex,
    markedFailed: Boolean(source),
  })
}

function getSafeFailureReason(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length === 0) return "retry attempts were exhausted."
  return normalized.slice(0, 500)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const sourceReconcileRouteWorkflow = {
  getPollWorkflowRunId,
  markSourceFailedAfterWorkflowFailure,
  normalizeReconcilePayload,
  runPollAndMirrorWorkflow,
  setContinuationTriggerForTesting,
}
