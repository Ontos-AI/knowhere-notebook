import "server-only"

import { Effect } from "effect"

import type { Source, Workspace } from "@/infrastructure/db/schema"
import type { SourceBlobUploadInput } from "./blob-upload"
import {
  type UploadKnowhereClient,
  uploadSourceBlobToKnowhereEffect,
  uploadSourceToKnowhereEffect,
} from "./upload"
import { retrySourceToKnowhereEffect } from "./retry"
import { sourceWorkflowRuntime } from "./workflow-runtime"

type SourceService = {
  readonly findInWorkspace: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Source | null>
  readonly getParseAssetUrls: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Readonly<Record<string, string>>>
  readonly listForWorkspace: (workspaceId: string) => Promise<Source[]>
  readonly localizeRemoteDocument: (
    workspaceId: string,
    input: Parameters<typeof sourceWorkflowRuntime.localizeRemoteDocument>[1],
  ) => Promise<Source>
  readonly updateSourceRevisionKey: (
    workspaceId: string,
    sourceId: string,
    revisionKey: string,
  ) => Promise<Source | null>
  readonly softDelete: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<boolean>
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
  readonly retrySourceToKnowhere: (
    workspace: Workspace,
    source: Source,
    knowhere: UploadKnowhereClient,
  ) => Promise<Source>
}

const uploadSourceToKnowhere: SourceService["uploadSourceToKnowhere"] = (
  workspace: Workspace,
  file: File,
  knowhere: UploadKnowhereClient,
) =>
  Effect.runPromise(
    uploadSourceToKnowhereEffect(workspace, file, {
      repository: sourceWorkflowRuntime.createUploadRepository(),
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
        repository: sourceWorkflowRuntime.createUploadRepository(),
        knowhere,
      }),
    )

const retrySourceToKnowhere: SourceService["retrySourceToKnowhere"] = (
  workspace: Workspace,
  source: Source,
  knowhere: UploadKnowhereClient,
) =>
  Effect.runPromise(
    retrySourceToKnowhereEffect(workspace, source, {
      repository: {
        markSourceFailed: sourceWorkflowRuntime.markFailed,
        markSourceParsing: sourceWorkflowRuntime.markParsing,
      },
      knowhere,
    }),
  )

export const sourceService: SourceService = {
  findInWorkspace: sourceWorkflowRuntime.findInWorkspace,
  getParseAssetUrls: sourceWorkflowRuntime.getParseAssetUrls,
  listForWorkspace: sourceWorkflowRuntime.listForWorkspace,
  localizeRemoteDocument: sourceWorkflowRuntime.localizeRemoteDocument,
  updateSourceRevisionKey: sourceWorkflowRuntime.updateRevisionKey,
  softDelete: sourceWorkflowRuntime.softDelete,
  uploadSourceToKnowhere,
  uploadSourceBlobToKnowhere,
  retrySourceToKnowhere,
}
