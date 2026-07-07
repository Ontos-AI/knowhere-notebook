import { Effect } from "effect"

import { demoView } from "@/domains/demo/view"
import { readAllSourceChunks, readSourceChunkPage } from "@/domains/chunks/read"
import { resolveChunkConnectionTargets } from "@/domains/chunks"
import type { DemoChunkPage } from "@/integrations/knowhere-demo"
import { logger } from "@/lib/logger"
import { routeResult } from "@/lib/route-result"
import { displayReadUnavailable } from "./display-read-unavailable"
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
  LoadSourceChunksInput,
  SourceChunksBody,
  SourceRouteServiceDependencies,
} from "./route-types"

type RouteChunksDependencies = Pick<
  SourceRouteServiceDependencies,
  | "demoApi"
  | "ensureApiKeyForWorkspace"
  | "ensureWorkspace"
  | "getCurrentUser"
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

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const loadSourceChunksEffect = (
  input: LoadSourceChunksInput,
  deps: RouteChunksDependencies,
) =>
  Effect.gen(function* () {
    if (!sourceRowRepository.isWorkspaceSourceId(input.sourceId)) {
      const demoResult = yield* loadDemoChunkPageEffect(input, deps)
      if (demoResult) return demoResult

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
    const source = yield* Effect.tryPromise(() =>
      deps.sourceService.findInWorkspace(workspace.id, input.sourceId),
    )

    if (!source) {
      return sourceNotFound()
    }

    if (source.demoKey) {
      const demoResult = yield* loadDemoChunkPageEffect(
        input,
        deps,
        source.demoKey,
        source.knowhereDocumentId,
      )
      return demoResult ?? sourceNotFound()
    }

    // Reads never return zero chunks for a ready remote document; the SDK falls
    // back to Knowhere when Blob storage is missing or stale. A source that is
    // not yet ready has no published document to read.
    if (source.status !== "ready" || !source.knowhereDocumentId) {
      return sourceSnapshotProcessing(input)
    }

    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id, input.cookieHeader),
    )
    const knowledge = getKnowledgeForSource({
      apiKey,
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: source.knowhereDocumentId,
      revisionKey: source.knowhereJobId,
    })
    const readableSource = {
      documentId: source.knowhereDocumentId,
      title: source.title,
      revisionKey: source.knowhereJobId,
    }

    if (input.shouldLoadAll) {
      return yield* Effect.tryPromise(() =>
        readAllSourceChunks({ knowledge, source: readableSource }),
      ).pipe(
        Effect.map((chunks) =>
          routeResult.ok({ chunks: resolveChunkConnectionTargets(chunks) }),
        ),
        Effect.catchAll((error) => recoverUnavailableChunks(input, error)),
      )
    }

    return yield* Effect.tryPromise(() =>
      readSourceChunkPage({
        knowledge,
        source: readableSource,
        params: input.pageParams,
      }),
    ).pipe(
      Effect.map((chunkPage) => routeResult.ok(chunkPage)),
      Effect.catchAll((error) => recoverUnavailableChunks(input, error)),
    )
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

    const knowledge = getKnowledgeForSource({
      apiKey,
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId,
      revisionKey: source.knowhereJobId ?? remoteDocument.revisionKey ?? null,
    })
    const readableSource = {
      documentId,
      title: source.title,
      revisionKey: source.knowhereJobId ?? remoteDocument.revisionKey ?? null,
    }

    if (input.shouldLoadAll) {
      return yield* Effect.tryPromise(() =>
        readAllSourceChunks({ knowledge, source: readableSource }),
      ).pipe(
        Effect.map((chunks) =>
          routeResult.ok({ chunks: resolveChunkConnectionTargets(chunks) }),
        ),
        Effect.catchAll((error) => recoverUnavailableChunks(input, error)),
      )
    }

    return yield* Effect.tryPromise(() =>
      readSourceChunkPage({
        knowledge,
        source: readableSource,
        params: input.pageParams,
      }),
    ).pipe(
      Effect.map((chunkPage) => routeResult.ok(chunkPage)),
      Effect.catchAll((error) => recoverUnavailableChunks(input, error)),
    )
  })

const loadDemoChunkPageEffect = (
  input: LoadSourceChunksInput,
  deps: RouteChunksDependencies,
  demoSourceId: string = input.sourceId,
  documentIdOverride?: string | null,
) =>
  Effect.gen(function* () {
    const pages = input.shouldLoadAll
      ? yield* Effect.tryPromise(() =>
          loadAllDemoChunkPages(input, deps, demoSourceId),
        )
      : [
          yield* Effect.tryPromise(() =>
            deps.demoApi.fetchChunkPage({
              demoSourceId,
              page: input.pageParams.page,
              pageSize: input.pageParams.pageSize,
            }),
          ),
        ]
    const page = pages[0]
    if (!page) return null
    const source = {
      id: page.demoSourceId,
      kind: "demo" as const,
      demoSourceId: page.demoSourceId,
      title: page.title,
      mimeType: page.mimeType,
      status: "ready" as const,
      documentId: documentIdOverride ?? page.canonicalDocumentId,
    }
    const chunks = pages.flatMap((demoChunkPage) =>
      demoChunkPage.chunks.map((chunk) =>
        demoView.toParsedChunkView(source, chunk),
      ),
    )

    return routeResult.ok(
      input.shouldLoadAll
        ? { chunks }
        : {
            chunks,
            pagination: page.pagination,
          },
    )
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.warn("sources: demo chunk load failed", {
          sourceId: input.sourceId,
          demoSourceId,
          page: input.pageParams.page,
          pageSize: input.pageParams.pageSize,
          shouldLoadAll: input.shouldLoadAll,
          knowhereBaseUrl: process.env.KNOWHERE_BASE_URL ?? "(default)",
          error: getErrorMessage(error),
        })
        return null
      }),
    ),
  )

async function loadAllDemoChunkPages(
  input: LoadSourceChunksInput,
  deps: RouteChunksDependencies,
  demoSourceId: string,
): Promise<DemoChunkPage[]> {
  const pageSize = 200
  const firstPage = await deps.demoApi.fetchChunkPage({
    demoSourceId,
    page: 1,
    pageSize,
  })
  const pages = [firstPage]
  for (
    let pageNumber = 2;
    pageNumber <= firstPage.pagination.totalPages;
    pageNumber += 1
  ) {
    pages.push(
      await deps.demoApi.fetchChunkPage({
        demoSourceId,
        page: pageNumber,
        pageSize,
      }),
    )
  }
  return pages
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const inner = (error as Error & { error?: unknown }).error
    return inner instanceof Error ? inner.message : error.message
  }
  return String(error)
}

function sourceNotFound(): JsonRouteResult<{ readonly message: string }> {
  return routeResult.error(404, "Source not found.")
}

function sourceSnapshotProcessing(
  input: LoadSourceChunksInput,
): JsonRouteResult<{
  readonly chunks: []
  readonly pagination?: {
    readonly page: number
    readonly pageSize: number
    readonly total: 0
    readonly totalPages: 0
  }
  readonly message: string
}> {
  if (input.shouldLoadAll) {
    return routeResult.ok(
      {
        chunks: [],
        message: "Source is still being prepared.",
      },
      202,
    )
  }

  return routeResult.ok(
    {
      chunks: [],
      pagination: {
        page: input.pageParams.page,
        pageSize: input.pageParams.pageSize,
        total: 0,
        totalPages: 0,
      },
      message: "Source is still being prepared.",
    },
    202,
  )
}

function sourceChunksUnavailable(
  input: LoadSourceChunksInput,
): JsonRouteResult<{
  readonly chunks: []
  readonly pagination?: {
    readonly page: number
    readonly pageSize: number
    readonly total: 0
    readonly totalPages: 0
  }
  readonly message: string
  readonly isUnavailable: true
}> {
  if (input.shouldLoadAll) {
    return routeResult.ok({
      chunks: [],
      message: displayReadUnavailable.message,
      isUnavailable: true,
    })
  }

  return routeResult.ok({
    chunks: [],
    pagination: {
      page: input.pageParams.page,
      pageSize: input.pageParams.pageSize,
      total: 0,
      totalPages: 0,
    },
    message: displayReadUnavailable.message,
    isUnavailable: true,
  })
}

function recoverUnavailableChunks(
  input: LoadSourceChunksInput,
  error: unknown,
): Effect.Effect<ReturnType<typeof sourceChunksUnavailable>, unknown> {
  return displayReadUnavailable.isError(error)
    ? Effect.succeed(sourceChunksUnavailable(input))
    : Effect.fail(error)
}

export { createRouteChunks }
