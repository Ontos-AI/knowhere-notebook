import "server-only"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { sourceRepository } from "./repository"
import type { Source, SourceParseResult } from "@/infrastructure/db/schema"
import type { UploadSourceRepository } from "./upload"

type CreateUploadingSourceInput = Parameters<
  typeof sourceRepository.createUploadingEffect
>[1]

type LocalizeRemoteDocumentInput = Parameters<
  typeof sourceRepository.localizeRemoteDocumentEffect
>[1]

type SaveSourceParseResultInput = Parameters<
  typeof sourceRepository.saveParseResultEffect
>[2]

type UploadRepositoryRuntime = {
  readonly createUploading: (
    workspaceId: string,
    input: CreateUploadingSourceInput,
  ) => Promise<Source>
  readonly markParsing: (
    workspaceId: string,
    sourceId: string,
    jobId: string,
    documentId?: string,
    requiredStatus?: string,
  ) => Promise<Source | null>
  readonly markFailed: (
    workspaceId: string,
    sourceId: string,
    reason: string,
    requiredStatus?: string,
  ) => Promise<Source | null>
}

type SourceWorkflowRuntime = UploadRepositoryRuntime & {
  readonly createUploadRepository: (
    runtime?: UploadRepositoryRuntime,
  ) => UploadSourceRepository
  readonly clearStagedBlob: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Source | null>
  readonly findInWorkspace: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Source | null>
  readonly getParseAssetUrls: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Readonly<Record<string, string>>>
  readonly getParseResultProgress: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<{
    readonly resultBlobUrl: string
    readonly assetUrlsByFilePath: Readonly<Record<string, string>>
  } | null>
  readonly listForWorkspace: (workspaceId: string) => Promise<Source[]>
  readonly localizeRemoteDocument: (
    workspaceId: string,
    input: LocalizeRemoteDocumentInput,
  ) => Promise<Source>
  readonly markReady: (
    workspaceId: string,
    sourceId: string,
    documentId: string,
  ) => Promise<Source | null>
  readonly updateRevisionKey: (
    workspaceId: string,
    sourceId: string,
    revisionKey: string,
  ) => Promise<Source | null>
  readonly saveParseResult: (
    workspaceId: string,
    sourceId: string,
    input: SaveSourceParseResultInput,
  ) => Promise<SourceParseResult | null>
  readonly mergeParseAssetUrls: (
    workspaceId: string,
    sourceId: string,
    input: SaveSourceParseResultInput,
  ) => Promise<SourceParseResult | null>
  readonly softDelete: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<boolean>
}

const findInWorkspace: SourceWorkflowRuntime["findInWorkspace"] = (
  workspaceId: string,
  sourceId: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.findInWorkspaceEffect(workspaceId, sourceId),
  )

const listForWorkspace: SourceWorkflowRuntime["listForWorkspace"] = (
  workspaceId: string,
) =>
  databaseRuntime.runPromise(sourceRepository.listForWorkspaceEffect(workspaceId))

const localizeRemoteDocument: SourceWorkflowRuntime["localizeRemoteDocument"] =
  (workspaceId: string, input: LocalizeRemoteDocumentInput) =>
    databaseRuntime.runPromise(
      sourceRepository.localizeRemoteDocumentEffect(workspaceId, input),
    )

const createUploading: SourceWorkflowRuntime["createUploading"] = (
  workspaceId: string,
  input: CreateUploadingSourceInput,
) =>
  databaseRuntime.runPromise(
    sourceRepository.createUploadingEffect(workspaceId, input),
  )

const markParsing: SourceWorkflowRuntime["markParsing"] = (
  workspaceId: string,
  sourceId: string,
  jobId: string,
  documentId?: string,
  requiredStatus?: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.markParsingEffect(
      workspaceId,
      sourceId,
      jobId,
      documentId,
      requiredStatus,
    ),
  )

const markReady: SourceWorkflowRuntime["markReady"] = (
  workspaceId: string,
  sourceId: string,
  documentId: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.markReadyEffect(workspaceId, sourceId, documentId),
  )

const updateRevisionKey: SourceWorkflowRuntime["updateRevisionKey"] = (
  workspaceId: string,
  sourceId: string,
  revisionKey: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.updateRevisionKeyEffect(
      workspaceId,
      sourceId,
      revisionKey,
    ),
  )

const markFailed: SourceWorkflowRuntime["markFailed"] = (
  workspaceId: string,
  sourceId: string,
  reason: string,
  requiredStatus?: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.markFailedEffect(workspaceId, sourceId, reason, requiredStatus),
  )

const clearStagedBlob: SourceWorkflowRuntime["clearStagedBlob"] = (
  workspaceId: string,
  sourceId: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.clearStagedBlobEffect(workspaceId, sourceId),
  )

const softDelete: SourceWorkflowRuntime["softDelete"] = (
  workspaceId: string,
  sourceId: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.softDeleteEffect(workspaceId, sourceId),
  )

const saveParseResult: SourceWorkflowRuntime["saveParseResult"] = (
  workspaceId: string,
  sourceId: string,
  input: SaveSourceParseResultInput,
) =>
  databaseRuntime.runPromise(
    sourceRepository.saveParseResultEffect(workspaceId, sourceId, input),
  )

const mergeParseAssetUrls: SourceWorkflowRuntime["mergeParseAssetUrls"] = (
  workspaceId: string,
  sourceId: string,
  input: SaveSourceParseResultInput,
) =>
  databaseRuntime.runPromise(
    sourceRepository.mergeParseAssetUrlsEffect(workspaceId, sourceId, input),
  )

const getParseResultProgress: SourceWorkflowRuntime["getParseResultProgress"] =
  (workspaceId: string, sourceId: string) =>
    databaseRuntime.runPromise(
      sourceRepository.getParseResultProgressEffect(workspaceId, sourceId),
    )

const getParseAssetUrls: SourceWorkflowRuntime["getParseAssetUrls"] = (
  workspaceId: string,
  sourceId: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.getParseAssetUrlsEffect(workspaceId, sourceId),
  )

function createUploadRepository(
  runtime: UploadRepositoryRuntime = sourceWorkflowRuntime,
): UploadSourceRepository {
  return {
    createUploadingSource: runtime.createUploading,
    markSourceParsing: async (
      workspaceId: string,
      sourceId: string,
      jobId: string,
      documentId?: string,
    ) =>
      requireSource(
        await runtime.markParsing(workspaceId, sourceId, jobId, documentId),
        "Source disappeared before parsing.",
      ),
    markSourceFailed: async (
      workspaceId: string,
      sourceId: string,
      reason: string,
    ) =>
      requireSource(
        await runtime.markFailed(workspaceId, sourceId, reason),
        "Source disappeared before failure.",
      ),
  }
}

function requireSource(source: Source | null, message: string): Source {
  if (!source) throw new Error(message)
  return source
}

export const sourceWorkflowRuntime: SourceWorkflowRuntime = {
  clearStagedBlob,
  createUploadRepository,
  createUploading,
  findInWorkspace,
  getParseAssetUrls,
  getParseResultProgress,
  listForWorkspace,
  localizeRemoteDocument,
  markFailed,
  markParsing,
  markReady,
  updateRevisionKey,
  mergeParseAssetUrls,
  saveParseResult,
  softDelete,
}
