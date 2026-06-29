import { serve } from "@upstash/workflow/nextjs"

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
import { sourceWorkflowRuntime } from "@/domains/sources/workflow-runtime"
import { makeKnowhereClient } from "@/integrations/knowhere"
import { logger } from "@/lib/logger"

type ReconcilePayload = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly apiKey: string
}

const MAX_POLL_ATTEMPTS = 60
const INITIAL_DELAY_S = 3
const MAX_DELAY_S = 30

export const { POST } = serve<ReconcilePayload>(async (context) => {
  const { workspaceId, sourceId, apiKey } = context.requestPayload
  const client = makeKnowhereClient(apiKey)
  let delay = INITIAL_DELAY_S
  let completedJob: {
    readonly jobId: string
    readonly documentId: string
  } | null = null

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
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
    delay = Math.min(Math.round(delay * 1.5), MAX_DELAY_S)
  }

  const jobToPrepare = completedJob
  if (!jobToPrepare) {
    logger.error("workflow: exhausted poll attempts", {
      sourceId,
      maxAttempts: MAX_POLL_ATTEMPTS,
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

  let batchIndex = 0
  for (;;) {
    const batch = await context.run(
      `parse-assets-batch-${batchIndex}`,
      async () =>
        prepareParsedResultAssetBatch({
          workspaceId,
          sourceId,
          jobId: jobToPrepare.jobId,
          resultBlobUrl,
          client,
          repository: sourceWorkflowRuntime,
        }),
    )
    if (!batch.hasMore) break
    batchIndex += 1
  }

  const ready = await context.run("source-ready", async () =>
    markSourceReadyAfterReconciliation({
      workspaceId,
      sourceId,
      documentId: jobToPrepare.documentId,
    }),
  )
  logger.info("workflow: source artifact preparation finished", {
    sourceId,
    status: ready.status,
    assetBatches: batchIndex + 1,
  })
})
