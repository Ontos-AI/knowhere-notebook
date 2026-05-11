import "server-only"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { sourceRepository } from "./repository"
import type { Source, SourceParseResult } from "@/infrastructure/db/schema"
import type { UploadSourceRepository } from "./upload"

type CreateUploadingSourceInput = Parameters<
  typeof sourceRepository.createUploadingEffect
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
  ) => Promise<Source | null>
  readonly markFailed: (
    workspaceId: string,
    sourceId: string,
    reason: string,
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
  readonly listForWorkspace: (workspaceId: string) => Promise<Source[]>
  readonly markReady: (
    workspaceId: string,
    sourceId: string,
    documentId: string,
  ) => Promise<Source | null>
  readonly saveParseResult: (
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
) =>
  databaseRuntime.runPromise(
    sourceRepository.markParsingEffect(workspaceId, sourceId, jobId),
  )

const markReady: SourceWorkflowRuntime["markReady"] = (
  workspaceId: string,
  sourceId: string,
  documentId: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.markReadyEffect(workspaceId, sourceId, documentId),
  )

const markFailed: SourceWorkflowRuntime["markFailed"] = (
  workspaceId: string,
  sourceId: string,
  reason: string,
) =>
  databaseRuntime.runPromise(
    sourceRepository.markFailedEffect(workspaceId, sourceId, reason),
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
    ) =>
      requireSource(
        await runtime.markParsing(workspaceId, sourceId, jobId),
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
  listForWorkspace,
  markFailed,
  markParsing,
  markReady,
  saveParseResult,
  softDelete,
}
