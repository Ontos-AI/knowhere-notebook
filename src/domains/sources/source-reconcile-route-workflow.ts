import "server-only"

import { Client, type WorkflowContext } from "@upstash/workflow"

import {
  completeResultZipMultipartUpload,
  createResultZipMultipartUploadPlan,
  getResultZipPartRange,
  prepareParsedResultAssetBatch,
  uploadResultZipPart,
  type MultipartUploadPart,
} from "@/domains/sources/parsed-result-assets"
import {
  markSourceReadyAfterReconciliation,
  pollSourceReconciliation,
} from "@/domains/sources/source-reconcile-workflow"
import { makeKnowhereClient } from "@/integrations/knowhere"
import { logger } from "@/lib/logger"
import { sourceWorkflowRuntime } from "./workflow-runtime"

type ReconcilePayload = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly apiKey: string
  readonly phase?: ReconcilePhase
  readonly segmentIndex?: number
}

type ReconcilePhase = "poll-and-mirror" | "asset-batches"

type NormalizedReconcilePayload = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly apiKey: string
  readonly phase: ReconcilePhase
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

const maxPollAttempts = 25
const maxAssetBatchesPerWorkflowRun = 20
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
      logger.info("workflow: source parse completed; preparing artifacts", {
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
          phase: "poll-and-mirror",
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

  const uploadPlan = await context.run("mirror-zip-start", async () =>
    createResultZipMultipartUploadPlan({
      workspaceId,
      sourceId,
      jobId: jobToPrepare.jobId,
      client,
    }),
  )
  logger.info("workflow: result ZIP multipart upload planned", {
    sourceId,
    jobId: jobToPrepare.jobId,
    sizeBytes: uploadPlan.sizeBytes,
    partCount: uploadPlan.partCount,
  })
  const parts: MultipartUploadPart[] = []

  for (let partNumber = 1; partNumber <= uploadPlan.partCount; partNumber++) {
    const range = getResultZipPartRange(
      partNumber,
      uploadPlan.partSizeBytes,
      uploadPlan.sizeBytes,
    )
    const part = await context.run(`mirror-zip-part-${partNumber}`, async () =>
      uploadResultZipPart({
        pathname: uploadPlan.pathname,
        key: uploadPlan.key,
        uploadId: uploadPlan.uploadId,
        partNumber,
        jobId: jobToPrepare.jobId,
        client,
        ...range,
      }),
    )
    parts.push(part)
    logger.info("workflow: result ZIP part mirrored", {
      sourceId,
      jobId: jobToPrepare.jobId,
      partNumber,
      partCount: uploadPlan.partCount,
      startByte: range.startByte,
      endByte: range.endByte,
    })
  }

  const resultBlobUrl = await context.run("mirror-zip-complete", async () => {
    const result = await completeResultZipMultipartUpload({
      pathname: uploadPlan.pathname,
      key: uploadPlan.key,
      uploadId: uploadPlan.uploadId,
      parts,
    })
    return result.url
  })
  logger.info("workflow: result ZIP multipart upload completed", {
    sourceId,
    jobId: jobToPrepare.jobId,
    partCount: parts.length,
  })

  await context.run("parse-result-save-zip", async () => {
    const saved = await sourceWorkflowRuntime.mergeParseAssetUrls(
      workspaceId,
      sourceId,
      {
        resultBlobUrl,
        assetUrlsByFilePath: {},
      },
    )
    if (!saved) throw new Error("Source disappeared before saving result ZIP.")
  })
  logger.info("workflow: result ZIP parse-result row saved", {
    sourceId,
    jobId: jobToPrepare.jobId,
  })

  await context.run("source-save-document-id", async () => {
    const saved = await sourceWorkflowRuntime.markParsing(
      workspaceId,
      sourceId,
      jobToPrepare.jobId,
      jobToPrepare.documentId,
      "parsing",
    )
    if (!saved) throw new Error("Source disappeared before saving document id.")
  })
  logger.info("workflow: source document id saved for asset continuation", {
    sourceId,
    jobId: jobToPrepare.jobId,
  })

  await context.run("trigger-asset-continuation-0", async () =>
    triggerContinuation({
      url: context.url,
      payload: {
        workspaceId,
        sourceId,
        apiKey,
        phase: "asset-batches",
        segmentIndex: 0,
      },
      workflowRunId: getAssetWorkflowRunId(sourceId, 0),
    }),
  )
  logger.info("workflow: parsed asset continuation triggered", {
    sourceId,
    jobId: jobToPrepare.jobId,
    segmentIndex: 0,
  })
}

async function runAssetBatchWorkflow(input: {
  readonly context: ReconcileWorkflowContext
  readonly payload: NormalizedReconcilePayload
}): Promise<void> {
  const { context, payload } = input
  const { workspaceId, sourceId, apiKey, segmentIndex } = payload
  const client = makeKnowhereClient(apiKey)
  const source = await context.run("load-source", async () =>
    sourceWorkflowRuntime.findInWorkspace(workspaceId, sourceId),
  )
  if (!source) {
    logger.info("workflow: asset continuation resolved missing source", {
      sourceId,
      segmentIndex,
    })
    return
  }
  if (source.status !== "parsing") {
    logger.info("workflow: asset continuation resolved non-parsing source", {
      sourceId,
      segmentIndex,
      status: source.status,
    })
    return
  }

  const jobId = source.knowhereJobId
  const documentId = source.knowhereDocumentId
  if (!jobId || !documentId) {
    await context.run("asset-continuation-failed-missing-job", async () =>
      sourceWorkflowRuntime.markFailed(
        workspaceId,
        sourceId,
        "Source artifact preparation is missing Knowhere job metadata.",
        "parsing",
      ),
    )
    logger.error("workflow: asset continuation missing Knowhere metadata", {
      sourceId,
      segmentIndex,
      hasJobId: Boolean(jobId),
      hasDocumentId: Boolean(documentId),
    })
    return
  }

  const progress = await context.run("load-parse-progress", async () =>
    sourceWorkflowRuntime.getParseResultProgress(workspaceId, sourceId),
  )
  if (!progress) {
    await context.run("asset-continuation-failed-missing-progress", async () =>
      sourceWorkflowRuntime.markFailed(
        workspaceId,
        sourceId,
        "Source artifact preparation is missing the mirrored parse result ZIP.",
        "parsing",
      ),
    )
    logger.error("workflow: asset continuation missing parse-result progress", {
      sourceId,
      segmentIndex,
      jobId,
    })
    return
  }

  let batchIndex = 0
  let lastBatch: {
    readonly uploadedCount: number
    readonly remainingCount: number
    readonly hasMore: boolean
  } | null = null
  while (batchIndex < maxAssetBatchesPerWorkflowRun) {
    const batch = await context.run(
      `parse-assets-batch-${segmentIndex}-${batchIndex}`,
      async () =>
        prepareParsedResultAssetBatch({
          workspaceId,
          sourceId,
          jobId,
          resultBlobUrl: progress.resultBlobUrl,
          client,
          repository: sourceWorkflowRuntime,
        }),
    )
    lastBatch = batch
    logger.info("workflow: parsed asset batch prepared", {
      sourceId,
      jobId,
      segmentIndex,
      batchIndex,
      uploadedCount: batch.uploadedCount,
      remainingCount: batch.remainingCount,
      hasMore: batch.hasMore,
    })
    if (!batch.hasMore) break
    batchIndex += 1
  }

  if (lastBatch?.hasMore) {
    const nextSegmentIndex = segmentIndex + 1
    await context.run(`trigger-asset-continuation-${nextSegmentIndex}`, async () =>
      triggerContinuation({
        url: context.url,
        payload: {
          workspaceId,
          sourceId,
          apiKey,
          phase: "asset-batches",
          segmentIndex: nextSegmentIndex,
        },
        workflowRunId: getAssetWorkflowRunId(sourceId, nextSegmentIndex),
      }),
    )
    logger.info("workflow: parsed asset continuation triggered", {
      sourceId,
      jobId,
      segmentIndex: nextSegmentIndex,
      remainingCount: lastBatch.remainingCount,
    })
    return
  }

  const ready = await context.run("source-ready", async () =>
    markSourceReadyAfterReconciliation({
      workspaceId,
      sourceId,
      documentId,
    }),
  )
  logger.info("workflow: source artifact preparation finished", {
    sourceId,
    jobId,
    status: ready.status,
    segmentIndex,
    assetBatches: batchIndex + 1,
  })
}

function normalizeReconcilePayload(
  payload: ReconcilePayload,
): NormalizedReconcilePayload {
  return {
    workspaceId: payload.workspaceId,
    sourceId: payload.sourceId,
    apiKey: payload.apiKey,
    phase: payload.phase ?? "poll-and-mirror",
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

function getAssetWorkflowRunId(sourceId: string, segmentIndex: number): string {
  return `${sourceId}-assets-${segmentIndex}`
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
  getAssetWorkflowRunId,
  getPollWorkflowRunId,
  markSourceFailedAfterWorkflowFailure,
  normalizeReconcilePayload,
  runAssetBatchWorkflow,
  runPollAndMirrorWorkflow,
  setContinuationTriggerForTesting,
}
