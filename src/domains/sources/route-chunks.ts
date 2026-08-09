import { Effect } from "effect"

import { routeResult } from "@/lib/route-result"
import {
  decodeRemoteSourceId,
  findRemoteLibraryDocumentBySourceId,
} from "./remote-library"
import { getClientForWorkspace } from "./route-dependencies"
import { sourceRowRepository } from "./source-row-repository"
import type {
  JsonRouteResult,
  LoadSourceChunksInput,
  SourceChunksBody,
  SourceRouteServiceDependencies,
} from "./route-types"

type RouteChunksDependencies = Pick<
  SourceRouteServiceDependencies,
  | "ensureApiKeyForWorkspace"
  | "ensureWorkspace"
  | "getCurrentUser"
  | "loadChunkPageForSource"
  | "loadChunksForSource"
  | "makeKnowhereClient"
  | "sourceService"
>

type RouteChunks = {
  readonly loadSourceChunks: (
    input: LoadSourceChunksInput,
  ) => Promise<JsonRouteResult<SourceChunksBody>>
}

function createRouteChunks(deps: RouteChunksDependencies): RouteChunks {
  return {
    loadSourceChunks: (input: LoadSourceChunksInput) =>
      Effect.runPromise(loadSourceChunksEffect(input, deps)),
  }
}

const loadSourceChunksEffect = (
  input: LoadSourceChunksInput,
  deps: RouteChunksDependencies,
) =>
  Effect.gen(function* () {
    if (!sourceRowRepository.isWorkspaceSourceId(input.sourceId)) {
      const remoteResult = yield* loadRemoteChunkPageEffect(input, deps)
      return remoteResult ?? sourceNotFound()
    }

    const user = yield* Effect.tryPromise(() => deps.getCurrentUser())
    if (!user) {
      return sourceNotFound()
    }

    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )
    if (!workspace) {
      return sourceNotFound()
    }
    const source = yield* Effect.tryPromise(() =>
      deps.sourceService.findInWorkspace(workspace.id, input.sourceId),
    )

    if (!source) {
      return sourceNotFound()
    }

    const client = yield* Effect.tryPromise(() =>
      getClientForWorkspace(workspace.id, input.cookieHeader, deps),
    )
    if (input.shouldLoadAll) {
      const chunks = yield* deps.loadChunksForSource(source, client, {
        workspaceId: workspace.id,
        onRevisionKey: async (revisionKey) => {
          await deps.sourceService.updateSourceRevisionKey(
            workspace.id,
            source.id,
            revisionKey,
          )
        },
      })
      return routeResult.ok({ chunks })
    }

    const assetUrlsByFilePath = yield* Effect.tryPromise(() =>
      deps.sourceService.getParseAssetUrls(workspace.id, source.id),
    )
    const chunkPage = yield* deps.loadChunkPageForSource(
      source,
      client,
      input.pageParams,
      {
        assetUrlsByFilePath,
        workspaceId: workspace.id,
        onRevisionKey: async (revisionKey) => {
          await deps.sourceService.updateSourceRevisionKey(
            workspace.id,
            source.id,
            revisionKey,
          )
        },
      },
    )
    return routeResult.ok(chunkPage)
  })

const loadRemoteChunkPageEffect = (
  input: LoadSourceChunksInput,
  deps: RouteChunksDependencies,
) =>
  Effect.gen(function* () {
    if (!decodeRemoteSourceId(input.sourceId)) return null

    const user = yield* Effect.tryPromise(() => deps.getCurrentUser())
    if (!user) return null

    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )
    if (!workspace) return null
    const client = yield* Effect.tryPromise(() =>
      getClientForWorkspace(workspace.id, input.cookieHeader, deps),
    )
    const remoteDocument = yield* findRemoteLibraryDocumentBySourceId({
      sourceId: input.sourceId,
      workspace,
      client,
      localSources: [],
    })
    if (!remoteDocument) return null

    const source = yield* Effect.tryPromise(() =>
      deps.sourceService.localizeRemoteDocument(workspace.id, {
        documentId: remoteDocument.documentId,
        namespace: remoteDocument.namespace,
        status: remoteDocument.status,
        title: remoteDocument.title,
        mimeType: remoteDocument.mimeType,
        sizeBytes: remoteDocument.sizeBytes,
        revisionKey: remoteDocument.revisionKey ?? null,
      }),
    )

    if (input.shouldLoadAll) {
      const chunks = yield* deps.loadChunksForSource(source, client, {
        workspaceId: workspace.id,
        onRevisionKey: async (revisionKey) => {
          await deps.sourceService.updateSourceRevisionKey(
            workspace.id,
            source.id,
            revisionKey,
          )
        },
      })
      return routeResult.ok({ chunks })
    }

    const chunkPage = yield* deps.loadChunkPageForSource(
      source,
      client,
      input.pageParams,
      {
        workspaceId: workspace.id,
        onRevisionKey: async (revisionKey) => {
          await deps.sourceService.updateSourceRevisionKey(
            workspace.id,
            source.id,
            revisionKey,
          )
        },
      },
    )
    return routeResult.ok(chunkPage)
  })

function sourceNotFound(): JsonRouteResult<{ readonly message: string }> {
  return routeResult.error(404, "Source not found.")
}

export { createRouteChunks }
