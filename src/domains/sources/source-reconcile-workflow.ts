import "server-only"

import { del } from "@vercel/blob"
import { NotFoundError, type JobResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import { logger } from "@/lib/logger"
import { sourceWorkflowRuntime } from "./workflow-runtime"

type SourceReconcileWorkflowClient = {
  readonly jobs: {
    get(jobId: string): Promise<JobResult>
  }
}

type ApiErrorLike = {
  readonly name?: string
  readonly statusCode?: number
  readonly message?: string
}

type SourceReconcileWorkflowRepository = {
  readonly findInWorkspace: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Source | null>
  readonly markFailed: (
    workspaceId: string,
    sourceId: string,
    reason: string,
    requiredStatus?: string,
  ) => Promise<Source | null>
  readonly markReady: (
    workspaceId: string,
    sourceId: string,
    documentId: string,
  ) => Promise<Source | null>
  readonly clearStagedBlob: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Source | null>
}

type SourceReconcileWorkflowBlobStore = {
  readonly deleteStagedSourceBlob: (pathname: string) => Promise<void>
}

export type PollSourceReconciliationInput = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly client: SourceReconcileWorkflowClient
  readonly repository?: SourceReconcileWorkflowRepository
  readonly blobStore?: SourceReconcileWorkflowBlobStore
}

export type MarkSourceReadyAfterReconciliationInput = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly documentId: string
  readonly repository?: SourceReconcileWorkflowRepository
  readonly blobStore?: SourceReconcileWorkflowBlobStore
}

export type MarkSourceFailedAfterReconciliationInput = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly reason: string
  readonly repository?: SourceReconcileWorkflowRepository
  readonly blobStore?: SourceReconcileWorkflowBlobStore
}

export type PollSourceReconciliationResult =
  | {
      readonly kind: "waiting"
      readonly jobId: string
      readonly jobStatus: string
    }
  | {
      readonly kind: "ready-to-prepare"
      readonly jobId: string
      readonly documentId: string
    }
  | {
      readonly kind: "resolved"
      readonly status: string
    }

export type MarkSourceReadyAfterReconciliationResult = {
  readonly status: string
}

export type MarkSourceFailedAfterReconciliationResult = {
  readonly status: string
}

export async function pollSourceReconciliation({
  workspaceId,
  sourceId,
  client,
  repository = sourceWorkflowRuntime,
  blobStore = vercelBlobStore,
}: PollSourceReconciliationInput): Promise<PollSourceReconciliationResult> {
  const source = await repository.findInWorkspace(workspaceId, sourceId)
  if (!source) return { kind: "resolved", status: "gone" }
  if (source.status !== "parsing") {
    return { kind: "resolved", status: source.status }
  }

  const jobId = source.knowhereJobId
  if (!jobId) {
    await failSourceAndCleanup({
      workspaceId,
      source,
      reason: "Parsing source is missing a Knowhere job id.",
      repository,
      blobStore,
    })
    return { kind: "resolved", status: "failed" }
  }

  const job = await getJobOrFailMissingJob({
    workspaceId,
    source,
    jobId,
    client,
    repository,
    blobStore,
  })
  if (!job) return { kind: "resolved", status: "failed" }
  if (isFailedJob(job)) {
    await failSourceAndCleanup({
      workspaceId,
      source,
      reason: job.error?.message ?? "Parsing failed.",
      repository,
      blobStore,
    })
    return { kind: "resolved", status: "failed" }
  }

  if (!isDoneJob(job)) {
    return {
      kind: "waiting",
      jobId,
      jobStatus: job.status,
    }
  }

  if (!job.documentId) {
    await failSourceAndCleanup({
      workspaceId,
      source,
      reason: "Parsing finished but Knowhere did not publish a document id.",
      repository,
      blobStore,
    })
    return { kind: "resolved", status: "failed" }
  }

  return {
    kind: "ready-to-prepare",
    jobId,
    documentId: job.documentId,
  }
}

async function getJobOrFailMissingJob(input: {
  readonly workspaceId: string
  readonly source: Source
  readonly jobId: string
  readonly client: SourceReconcileWorkflowClient
  readonly repository: SourceReconcileWorkflowRepository
  readonly blobStore: SourceReconcileWorkflowBlobStore
}): Promise<JobResult | null> {
  try {
    return await input.client.jobs.get(input.jobId)
  } catch (error) {
    if (!isKnowhereJobNotFoundError(error)) throw error

    await failSourceAndCleanup({
      workspaceId: input.workspaceId,
      source: input.source,
      reason: `Knowhere job ${input.jobId} was not found during reconciliation.`,
      repository: input.repository,
      blobStore: input.blobStore,
    })
    return null
  }
}

export async function markSourceReadyAfterReconciliation({
  workspaceId,
  sourceId,
  documentId,
  repository = sourceWorkflowRuntime,
  blobStore = vercelBlobStore,
}: MarkSourceReadyAfterReconciliationInput): Promise<MarkSourceReadyAfterReconciliationResult> {
  const source = await repository.findInWorkspace(workspaceId, sourceId)
  if (!source) return { status: "gone" }
  if (source.status !== "parsing") return { status: source.status }

  const readySource = await repository.markReady(
    workspaceId,
    sourceId,
    documentId,
  )
  if (!readySource) return { status: "unchanged" }

  await cleanupStagedBlob({
    workspaceId,
    source,
    repository,
    blobStore,
  })
  return { status: readySource.status }
}

export async function markSourceFailedAfterReconciliation({
  workspaceId,
  sourceId,
  reason,
  repository = sourceWorkflowRuntime,
  blobStore = vercelBlobStore,
}: MarkSourceFailedAfterReconciliationInput): Promise<MarkSourceFailedAfterReconciliationResult> {
  const source = await repository.findInWorkspace(workspaceId, sourceId)
  if (!source) return { status: "gone" }
  if (source.status !== "parsing") return { status: source.status }

  await failSourceAndCleanup({
    workspaceId,
    source,
    reason,
    repository,
    blobStore,
  })
  return { status: "failed" }
}

async function failSourceAndCleanup(input: {
  readonly workspaceId: string
  readonly source: Source
  readonly reason: string
  readonly repository: SourceReconcileWorkflowRepository
  readonly blobStore: SourceReconcileWorkflowBlobStore
}): Promise<void> {
  await input.repository.markFailed(
    input.workspaceId,
    input.source.id,
    input.reason,
    "parsing",
  )
  await cleanupStagedBlob(input)
}

async function cleanupStagedBlob(input: {
  readonly workspaceId: string
  readonly source: Source
  readonly repository: SourceReconcileWorkflowRepository
  readonly blobStore: SourceReconcileWorkflowBlobStore
}): Promise<void> {
  if (!input.source.stagedBlobPathname) return

  try {
    await input.blobStore.deleteStagedSourceBlob(input.source.stagedBlobPathname)
    await input.repository.clearStagedBlob(
      input.workspaceId,
      input.source.id,
    )
  } catch (error) {
    logger.warn("source-reconcile-workflow: staged blob cleanup failed", {
      workspaceId: input.workspaceId,
      sourceId: input.source.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function isDoneJob(job: JobResult): boolean {
  return job.isDone || job.status === "done"
}

function isFailedJob(job: JobResult): boolean {
  return job.isFailed || job.status === "failed"
}

function isKnowhereJobNotFoundError(error: unknown): boolean {
  if (error instanceof NotFoundError) return true
  if (!isApiErrorLike(error)) return false

  return error.name === "NotFoundError" || error.statusCode === 404
}

function isApiErrorLike(error: unknown): error is ApiErrorLike {
  return error !== null && typeof error === "object"
}

const vercelBlobStore: SourceReconcileWorkflowBlobStore = {
  deleteStagedSourceBlob: del,
}
