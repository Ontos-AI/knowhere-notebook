import { Effect } from "effect"

import { readSourcePageAssets } from "./page-assets"
import { routeResult } from "@/lib/route-result"
import { displayReadUnavailable } from "./display-read-unavailable"
import {
  decodeRemoteSourceId,
  findRemoteLibraryDocumentBySourceId,
} from "./remote-library"
import {
  getClientForWorkspace,
  getKnowledgeResourcesForSource,
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
    const readResources = getKnowledgeResourcesForSource({
      apiKey,
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId,
      revisionKey: source.knowhereJobId,
    })
    return yield* Effect.tryPromise(() =>
      readSourcePageAssets({
        client: readResources.client,
        knowledge: readResources.knowledge,
        source: {
          documentId,
          revisionKey: source.knowhereJobId,
        },
        params: input.pageParams,
      }),
    ).pipe(
      Effect.map((pageAssets) => routeResult.ok(pageAssets)),
      Effect.catchAll((error) =>
        recoverUnavailablePageAssets(input, error),
      ),
    )
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
    const readResources = getKnowledgeResourcesForSource({
      apiKey,
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId,
      revisionKey,
    })
    return yield* Effect.tryPromise(() =>
      readSourcePageAssets({
        client: readResources.client,
        knowledge: readResources.knowledge,
        source: { documentId, revisionKey },
        params: input.pageParams,
      }),
    ).pipe(
      Effect.map((pageAssets) => routeResult.ok(pageAssets)),
      Effect.catchAll((error) =>
        recoverUnavailablePageAssets(input, error),
      ),
    )
  })

function sourceNotFound(): JsonRouteResult<{ readonly message: string }> {
  return routeResult.error(404, "Source not found.")
}

function sourceNotReady(): JsonRouteResult<{ readonly message: string }> {
  return routeResult.error(409, "Source is not ready.")
}

function sourcePageAssetsUnavailable(
  input: LoadSourcePageAssetsInput,
): {
  readonly pages: []
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly total: 0
    readonly totalPages: 0
  }
  readonly message: string
  readonly isUnavailable: true
} {
  return {
    pages: [],
    pagination: {
      page: input.pageParams.page,
      pageSize: input.pageParams.pageSize,
      total: 0,
      totalPages: 0,
    },
    message: displayReadUnavailable.message,
    isUnavailable: true,
  }
}

function recoverUnavailablePageAssets(
  input: LoadSourcePageAssetsInput,
  error: unknown,
): Effect.Effect<
  JsonRouteResult<ReturnType<typeof sourcePageAssetsUnavailable>>,
  unknown
> {
  return displayReadUnavailable.isError(error)
    ? Effect.succeed(routeResult.ok(sourcePageAssetsUnavailable(input)))
    : Effect.fail(error)
}

export { createRoutePageAssets }
