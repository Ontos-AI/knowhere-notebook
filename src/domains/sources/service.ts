import "server-only"

import { Effect } from "effect"

import { databaseRuntime } from "../workspace/database-runtime"
import { sourceRepository } from "./repository"
import {
  type UploadKnowhereClient,
  type UploadSourceRepository,
  uploadSourceBlobToKnowhereEffect,
  uploadSourceToKnowhereEffect,
} from "./upload"
import type { Source, SourceParseResult, Workspace } from "@/infrastructure/db/schema"
import type { SourceBlobUploadInput } from "./blob-upload"

type CreateUploadingSourceInput = Parameters<
  typeof sourceRepository.createUploadingEffect
>[1]

type SaveSourceParseResultInput = Parameters<
  typeof sourceRepository.saveParseResultEffect
>[2]

type SourceService = {
  readonly findInWorkspaceEffect: typeof sourceRepository.findInWorkspaceEffect
  readonly listForWorkspaceEffect: typeof sourceRepository.listForWorkspaceEffect
  readonly createUploadingEffect: typeof sourceRepository.createUploadingEffect
  readonly markParsingEffect: typeof sourceRepository.markParsingEffect
  readonly markReadyEffect: typeof sourceRepository.markReadyEffect
  readonly markFailedEffect: typeof sourceRepository.markFailedEffect
  readonly clearStagedBlobEffect: typeof sourceRepository.clearStagedBlobEffect
  readonly softDeleteEffect: typeof sourceRepository.softDeleteEffect
  readonly saveParseResultEffect: typeof sourceRepository.saveParseResultEffect
  readonly getParseAssetUrlsEffect: typeof sourceRepository.getParseAssetUrlsEffect
  readonly findInWorkspace: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Source | null>
  readonly listForWorkspace: (workspaceId: string) => Promise<Source[]>
  readonly createUploading: (
    workspaceId: string,
    input: CreateUploadingSourceInput,
  ) => Promise<Source>
  readonly markParsing: (
    workspaceId: string,
    sourceId: string,
    jobId: string,
  ) => Promise<Source | null>
  readonly markReady: (
    workspaceId: string,
    sourceId: string,
    documentId: string,
  ) => Promise<Source | null>
  readonly markFailed: (
    workspaceId: string,
    sourceId: string,
    reason: string,
  ) => Promise<Source | null>
  readonly clearStagedBlob: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Source | null>
  readonly softDelete: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<boolean>
  readonly saveParseResult: (
    workspaceId: string,
    sourceId: string,
    input: SaveSourceParseResultInput,
  ) => Promise<SourceParseResult | null>
  readonly getParseAssetUrls: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Readonly<Record<string, string>>>
  readonly uploadSourceToKnowhere: (
    workspace: Workspace,
    file: File,
    knowhere: UploadKnowhereClient,
  ) => Promise<Source>
  readonly uploadSourceBlobToKnowhere: (
    workspace: Workspace,
    input: SourceBlobUploadInput,
    knowhere: UploadKnowhereClient,
  ) => Promise<Source>
}

const findInWorkspace = (workspaceId: string, sourceId: string) =>
  databaseRuntime.runPromise(
    sourceRepository.findInWorkspaceEffect(workspaceId, sourceId),
  )

const listForWorkspace = (workspaceId: string) =>
  databaseRuntime.runPromise(sourceRepository.listForWorkspaceEffect(workspaceId))

const createUploading = (
  workspaceId: string,
  input: CreateUploadingSourceInput,
) =>
  databaseRuntime.runPromise(
    sourceRepository.createUploadingEffect(workspaceId, input),
  )

const markParsing = (workspaceId: string, sourceId: string, jobId: string) =>
  databaseRuntime.runPromise(
    sourceRepository.markParsingEffect(workspaceId, sourceId, jobId),
  )

const markReady = (workspaceId: string, sourceId: string, documentId: string) =>
  databaseRuntime.runPromise(
    sourceRepository.markReadyEffect(workspaceId, sourceId, documentId),
  )

const markFailed = (workspaceId: string, sourceId: string, reason: string) =>
  databaseRuntime.runPromise(
    sourceRepository.markFailedEffect(workspaceId, sourceId, reason),
  )

const clearStagedBlob = (workspaceId: string, sourceId: string) =>
  databaseRuntime.runPromise(
    sourceRepository.clearStagedBlobEffect(workspaceId, sourceId),
  )

const softDelete = (workspaceId: string, sourceId: string) =>
  databaseRuntime.runPromise(
    sourceRepository.softDeleteEffect(workspaceId, sourceId),
  )

const saveParseResult = (
  workspaceId: string,
  sourceId: string,
  input: SaveSourceParseResultInput,
) =>
  databaseRuntime.runPromise(
    sourceRepository.saveParseResultEffect(workspaceId, sourceId, input),
  )

const getParseAssetUrls = (workspaceId: string, sourceId: string) =>
  databaseRuntime.runPromise(
    sourceRepository.getParseAssetUrlsEffect(workspaceId, sourceId),
  )

const uploadSourceToKnowhere: SourceService["uploadSourceToKnowhere"] = (
  workspace: Workspace,
  file: File,
  knowhere: UploadKnowhereClient,
) =>
  Effect.runPromise(
    uploadSourceToKnowhereEffect(workspace, file, {
      repository: createUploadRepository(),
      knowhere,
    }),
  )

const uploadSourceBlobToKnowhere: SourceService["uploadSourceBlobToKnowhere"] =
  (
    workspace: Workspace,
    input: SourceBlobUploadInput,
    knowhere: UploadKnowhereClient,
  ) =>
    Effect.runPromise(
      uploadSourceBlobToKnowhereEffect(workspace, input, {
        repository: createUploadRepository(),
        knowhere,
      }),
    )

function createUploadRepository(): UploadSourceRepository {
  return {
    createUploadingSource: createUploading,
    markSourceParsing: async (
      workspaceId: string,
      sourceId: string,
      jobId: string,
    ) =>
      requireSource(
        await markParsing(workspaceId, sourceId, jobId),
        "Source disappeared before parsing.",
      ),
    markSourceFailed: async (
      workspaceId: string,
      sourceId: string,
      reason: string,
    ) =>
      requireSource(
        await markFailed(workspaceId, sourceId, reason),
        "Source disappeared before failure.",
      ),
  }
}

function requireSource(source: Source | null, message: string): Source {
  if (!source) throw new Error(message)
  return source
}

export const sourceService: SourceService = {
  findInWorkspaceEffect: sourceRepository.findInWorkspaceEffect,
  listForWorkspaceEffect: sourceRepository.listForWorkspaceEffect,
  createUploadingEffect: sourceRepository.createUploadingEffect,
  markParsingEffect: sourceRepository.markParsingEffect,
  markReadyEffect: sourceRepository.markReadyEffect,
  markFailedEffect: sourceRepository.markFailedEffect,
  clearStagedBlobEffect: sourceRepository.clearStagedBlobEffect,
  softDeleteEffect: sourceRepository.softDeleteEffect,
  saveParseResultEffect: sourceRepository.saveParseResultEffect,
  getParseAssetUrlsEffect: sourceRepository.getParseAssetUrlsEffect,
  findInWorkspace,
  listForWorkspace,
  createUploading,
  markParsing,
  markReady,
  markFailed,
  clearStagedBlob,
  softDelete,
  saveParseResult,
  getParseAssetUrls,
  uploadSourceToKnowhere,
  uploadSourceBlobToKnowhere,
}
