import "server-only"

import { Client, type WorkflowContext } from "@upstash/workflow"

import {
  markSourceFailedAfterReconciliation,
  markSourceReadyAfterReconciliation,
  pollSourceReconciliation,
} from "@/domains/sources/source-reconcile-workflow"
import { makeKnowhereClient } from "@/integrations/knowhere"
import { logger } from "@/lib/logger"
import { prepareSourcePageCitationAssets } from "./page-citation-assets"
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

type PageCitationAssetPreparationStepResult =
  | {
      readonly ok: true
      readonly warnings: Awaited<
        ReturnType<typeof prepareSourcePageCitationAssets>
      >["warnings"]
    }
  | {
      readonly ok: false
      readonly reason: string
      readonly error: string
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
  const client = makeKnowhereClient(apiKey)
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

  const preparation = await runPageCitationAssetPreparation({
    context,
    workspaceId,
    sourceId,
    client,
    jobId: jobToPrepare.jobId,
    documentId: jobToPrepare.documentId,
  })
  if (!preparation.ok) return

  const ready = await context.run("source-ready", async () =>
    markSourceReadyAfterReconciliation({
      workspaceId,
      sourceId,
      documentId: jobToPrepare.documentId,
    }),
  )
  logger.info("workflow: source parse reconciliation finished", {
    sourceId,
    jobId: jobToPrepare.jobId,
    status: ready.status,
  })
}

async function runPageCitationAssetPreparation(input: {
  readonly context: ReconcileWorkflowContext
  readonly workspaceId: string
  readonly sourceId: string
  readonly client: ReturnType<typeof makeKnowhereClient>
  readonly jobId: string
  readonly documentId: string
}): Promise<{ readonly ok: boolean }> {
  const result = await input.context.run(
    "prepare-page-citation-assets",
    async (): Promise<PageCitationAssetPreparationStepResult> => {
      try {
        const preparation = await prepareSourcePageCitationAssets({
          client: input.client,
          sourceId: input.sourceId,
          jobId: input.jobId,
          documentId: input.documentId,
        })

        return {
          ok: true,
          warnings: preparation.warnings,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          reason: `Page citation asset preparation failed: ${getSafeFailureReason(
            errorMessage,
          )}`,
          error: errorMessage,
        }
      }
    },
  )

  if (!result.ok) {
    const failed = await input.context.run(
      "source-failed-page-citation-assets",
      async () =>
        markSourceFailedAfterReconciliation({
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
          reason: result.reason,
        }),
    )
    logger.error("workflow: page citation asset preparation failed", {
      sourceId: input.sourceId,
      jobId: input.jobId,
      documentId: input.documentId,
      status: failed.status,
      error: result.error,
    })
    return { ok: false }
  }

  for (const warning of result.warnings) {
    logger.warn("workflow: page citation asset warning", {
      sourceId: input.sourceId,
      jobId: input.jobId,
      documentId: input.documentId,
      warning,
    })
  }
  logger.info("workflow: page citation assets prepared", {
    sourceId: input.sourceId,
    jobId: input.jobId,
    documentId: input.documentId,
    warningCount: result.warnings.length,
  })
  return { ok: true }
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

export const sourceReconcileRouteWorkflow = {
  getPollWorkflowRunId,
  markSourceFailedAfterWorkflowFailure,
  normalizeReconcilePayload,
  runPollAndMirrorWorkflow,
  setContinuationTriggerForTesting,
}
