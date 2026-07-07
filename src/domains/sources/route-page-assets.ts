import { Effect } from "effect"

import { readSourcePageAssets } from "./page-assets"
import { routeResult } from "@/lib/route-result"
import {
  decodeRemoteSourceId,
  findRemoteLibraryDocumentBySourceId,
} from "./remote-library"
import {
  getClientForWorkspace,
  getKnowledgeForSource,
} from "./route-dependencies"
import { sourceRowRepository } from "./source-row-repository"
import type {
  JsonRouteResult,
  LoadSourcePageAssetsInput,
  SourcePageAssetsBody,
  SourceRouteServiceDependencies,
} from "./route-types"

type RoutePageAssetsDependencies = Pick<
  SourceRouteServiceDependencies,
  | "ensureApiKeyForWorkspace"
  | "ensureWorkspace"
  | "getCurrentUser"
  | "makeKnowhereClient"
  | "sourceService"
>

type RoutePageAssets = {
  readonly loadSourcePageAssets: (
    input: LoadSourcePageAssetsInput,
  ) => Promise<JsonRouteResult<SourcePageAssetsBody>>
}

function createRoutePageAssets(
  deps: RoutePageAssetsDependencies,
): RoutePageAssets {
  return {
    loadSourcePageAssets: (input: LoadSourcePageAssetsInput) =>
      Effect.runPromise(loadSourcePageAssetsEffect(input, deps)),
  }
}

const loadSourcePageAssetsEffect = (
  input: LoadSourcePageAssetsInput,
  deps: RoutePageAssetsDependencies,
) =>
  Effect.gen(function* () {
    if (!sourceRowRepository.isWorkspaceSourceId(input.sourceId)) {
      const remoteResult = yield* loadRemotePageAssetsEffect(input, deps)
      return remoteResult ?? sourceNotFound()
    }

    const user = yield* Effect.tryPromise(() => deps.getCurrentUser())
    if (!user) return sourceNotFound()

    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )
    const source = yield* Effect.tryPromise(() =>
      deps.sourceService.findInWorkspace(workspace.id, input.sourceId),
    )
    if (!source) return sourceNotFound()
    if (source.status !== "ready" || !source.knowhereDocumentId) {
      return sourceNotReady()
    }

    const documentId = source.knowhereDocumentId
    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id, input.cookieHeader),
    )
    const knowledge = getKnowledgeForSource({
      apiKey,
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId,
      revisionKey: source.knowhereJobId,
    })
    const pageAssets = yield* Effect.tryPromise(() =>
      readSourcePageAssets({
        knowledge,
        source: {
          documentId,
          revisionKey: source.knowhereJobId,
        },
        params: input.pageParams,
      }),
    )

    return routeResult.ok(pageAssets)
  })

const loadRemotePageAssetsEffect = (
  input: LoadSourcePageAssetsInput,
  deps: RoutePageAssetsDependencies,
) =>
  Effect.gen(function* () {
    if (!decodeRemoteSourceId(input.sourceId)) return null

    const user = yield* Effect.tryPromise(() => deps.getCurrentUser())
    if (!user) return null

    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )
    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id, input.cookieHeader),
    )
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
    const documentId = source.knowhereDocumentId ?? remoteDocument.documentId
    const revisionKey =
      source.knowhereJobId ?? remoteDocument.revisionKey ?? null
    const knowledge = getKnowledgeForSource({
      apiKey,
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId,
      revisionKey,
    })
    const pageAssets = yield* Effect.tryPromise(() =>
      readSourcePageAssets({
        knowledge,
        source: { documentId, revisionKey },
        params: input.pageParams,
      }),
    )

    return routeResult.ok(pageAssets)
  })

function sourceNotFound(): JsonRouteResult<{ readonly message: string }> {
  return routeResult.error(404, "Source not found.")
}

function sourceNotReady(): JsonRouteResult<{ readonly message: string }> {
  return routeResult.error(409, "Source is not ready.")
}

export { createRoutePageAssets }
