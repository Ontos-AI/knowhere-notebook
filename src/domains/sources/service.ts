import "server-only"

import { Effect } from "effect"

import type { Source, Workspace } from "@/infrastructure/db/schema"
import type { SourceBlobUploadInput } from "./blob-upload"
import {
  type UploadKnowhereClient,
  uploadSourceBlobToKnowhereEffect,
  uploadSourceToKnowhereEffect,
} from "./upload"
import { syncRemoteParsedSnapshot } from "./remote-parsed-snapshot-sync"
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
  readonly getParseSnapshotMetadata: (
    workspaceId: string,
    sourceId: string,
  ) => ReturnType<typeof sourceWorkflowRuntime.getParseSnapshotMetadata>
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
  readonly listHiddenDemoSourceIds: (workspaceId: string) => Promise<string[]>
  readonly hideDemoSource: (
    workspaceId: string,
    demoSourceId: string,
  ) => Promise<void>
  readonly softDelete: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<boolean>
  readonly upsertMaterializedDemoSource: (
    workspaceId: string,
    input: Parameters<
      typeof sourceWorkflowRuntime.upsertMaterializedDemoSource
    >[1],
  ) => Promise<Source>
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
  readonly syncRemoteParsedSnapshot: typeof syncRemoteParsedSnapshot
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
  getParseSnapshotMetadata: sourceWorkflowRuntime.getParseSnapshotMetadata,
  hideDemoSource: sourceWorkflowRuntime.hideDemoSource,
  listHiddenDemoSourceIds: sourceWorkflowRuntime.listHiddenDemoSourceIds,
  listForWorkspace: sourceWorkflowRuntime.listForWorkspace,
  localizeRemoteDocument: sourceWorkflowRuntime.localizeRemoteDocument,
  updateSourceRevisionKey: sourceWorkflowRuntime.updateRevisionKey,
  softDelete: sourceWorkflowRuntime.softDelete,
  upsertMaterializedDemoSource:
    sourceWorkflowRuntime.upsertMaterializedDemoSource,
  uploadSourceToKnowhere,
  uploadSourceBlobToKnowhere,
  retrySourceToKnowhere,
  syncRemoteParsedSnapshot,
}
