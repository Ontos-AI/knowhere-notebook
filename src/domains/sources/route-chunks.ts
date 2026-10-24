import { Cause, Effect, Option, Runtime } from "effect"

import { demoView } from "@/domains/demo/view"
import { readAllSourceChunks, readSourceChunkPage } from "@/domains/chunks/read"
import { resolveChunkConnectionTargets, type ChunkReadType } from "@/domains/chunks"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { DemoChunkPage } from "@/integrations/knowhere-demo"
import { logger } from "@/lib/logger"
import { routeResult } from "@/lib/route-result"
import { getCompatibleNamespaces } from "./namespace"
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
      if (decodeRemoteSourceId(input.sourceId)) {
        const remoteResult = yield* loadRemoteChunkPageEffect(input, deps)
        return remoteResult ?? sourceNotFound()
      }
      const demoResult = yield* loadDemoChunkPageEffect(input, deps)
      return demoResult ?? sourceNotFound()
    }

    const user = yield* Effect.tryPromise(() => deps.getCurrentUser())
    if (!user) {
      return sourceNotFound()
    }

    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )
    const source = yield* Effect.tryPromise(
      async () => {
        const source = await deps.sourceService.findInWorkspace(workspace.id, input.sourceId)
        return source ?? await deps.sourceService.findLegacyDemoSource?.(workspace.id, input.sourceId) ?? null
      },
    )

    if (!source) {
      return sourceNotFound()
    }

    // Reads never return zero chunks for a ready remote document; the SDK falls
    // back to Knowhere when Blob storage is missing or stale. A source that is
    // not yet ready has no published document to read.
    if (source.status !== "ready" || !source.knowhereDocumentId) {
      return sourceSnapshotProcessing(input)
    }

    if (input.pageParams.namespace && !getCompatibleNamespaces(workspace).includes(input.pageParams.namespace)) return sourceChunksUnavailable(input)
    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id, input.cookieHeader),
    )
    const readResources = getKnowledgeResourcesForSource({
      apiKey,
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId: source.knowhereDocumentId,
      revisionKey: source.knowhereJobId,
    })
    const readableSource = {
      documentId: source.knowhereDocumentId,
      title: source.title,
      namespace: input.pageParams.namespace ?? workspace.namespace,
      ...(input.pageParams.jobResultId ? { jobResultId: input.pageParams.jobResultId } : {}),
      revisionKey: source.knowhereJobId,
    }

    if (input.shouldLoadAll) {
      return yield* Effect.tryPromise(() =>
        readAllSourceChunks({
          client: readResources.client,
          knowledge: readResources.knowledge,
          source: readableSource,
          ...(input.pageParams.chunkType
            ? { chunkType: input.pageParams.chunkType }
            : {}),
        }),
      ).pipe(
        Effect.map((chunks) =>
          routeResult.ok({ chunks: resolveChunkConnectionTargets(chunks) }),
        ),
        Effect.catchAll((error) => recoverUnavailableChunks(input, error)),
      )
    }

    return yield* Effect.tryPromise(() =>
      readSourceChunkPage({
        client: readResources.client,
        knowledge: readResources.knowledge,
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

    const readResources = getKnowledgeResourcesForSource({
      apiKey,
      workspaceId: workspace.id,
      sourceId: source.id,
      documentId,
      revisionKey: source.knowhereJobId ?? remoteDocument.revisionKey ?? null,
    })
    const readableSource = {
      documentId,
      title: source.title,
      namespace: input.pageParams.namespace ?? remoteDocument.namespace,
      ...(input.pageParams.jobResultId ? { jobResultId: input.pageParams.jobResultId } : {}),
      revisionKey: source.knowhereJobId ?? remoteDocument.revisionKey ?? null,
    }

    if (input.shouldLoadAll) {
      return yield* Effect.tryPromise(() =>
        readAllSourceChunks({
          client: readResources.client,
          knowledge: readResources.knowledge,
          source: readableSource,
          ...(input.pageParams.chunkType
            ? { chunkType: input.pageParams.chunkType }
            : {}),
        }),
      ).pipe(
        Effect.map((chunks) =>
          routeResult.ok({ chunks: resolveChunkConnectionTargets(chunks) }),
        ),
        Effect.catchAll((error) => recoverUnavailableChunks(input, error)),
      )
    }

    return yield* Effect.tryPromise(() =>
      readSourceChunkPage({
        client: readResources.client,
        knowledge: readResources.knowledge,
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
              ...(input.pageParams.jobResultId ? { jobResultId: input.pageParams.jobResultId } : {}),
              ...(input.pageParams.chunkType ? { chunkType: input.pageParams.chunkType } : {}),
            }),
          ),
        ]
    const page = pages[0]
    if (!page) return null
    const expectedJobResultId: string | undefined = input.pageParams.jobResultId ?? page.jobResultId
    if (expectedJobResultId && pages.some((candidate) => candidate.jobResultId !== expectedJobResultId)) return sourceChunksUnavailable(input)
    const source = {
      id: page.demoSourceId,
      kind: "demo" as const,
      demoSourceId: page.demoSourceId,
      title: page.title,
      mimeType: page.mimeType,
      status: "ready" as const,
      documentId: page.canonicalDocumentId,
      namespace: page.namespace,
      jobResultId: page.jobResultId,
    }
    const chunks = filterChunksByType(
      pages.flatMap((demoChunkPage) =>
        demoChunkPage.chunks.map((chunk) =>
          ({ ...demoView.toParsedChunkView(source, chunk), namespace: page.namespace, jobResultId: page.jobResultId }),
        ),
      ),
      input.pageParams.chunkType,
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
        const status: DemoReadFailureStatus | undefined = readDemoFailureStatus(error)
        if (status !== undefined) return createDemoReadFailure(input, status)
        return input.pageParams.jobResultId ? sourceChunksUnavailable(input) : null
      }),
    ),
  )

type DemoReadFailureStatus = 401 | 404 | 409 | 503

function readDemoFailureStatus(error: unknown, depth: number = 0): DemoReadFailureStatus | undefined {
  if (depth > 8) return undefined
  if (Runtime.isFiberFailure(error)) {
    const failure = Cause.failureOption(error[Runtime.FiberFailureCauseId])
    return Option.isSome(failure) ? readDemoFailureStatus(failure.value, depth + 1) : undefined
  }
  if (typeof error !== "object" || error === null) return undefined
  if ("status" in error && (error.status === 401 || error.status === 404 || error.status === 409 || error.status === 503)) return error.status
  return "cause" in error ? readDemoFailureStatus(error.cause, depth + 1) : undefined
}

function createDemoReadFailure(input: LoadSourceChunksInput, status: DemoReadFailureStatus): JsonRouteResult<SourceChunksBody> {
  const message: string = status === 401
    ? "Sign in to read this demo source."
    : status === 404
      ? input.pageParams.jobResultId ? "This cited source revision is unavailable." : "Demo source not found."
      : status === 409
        ? "Demo source is still being prepared. Please try again shortly."
        : "Demo sources are temporarily unavailable. Please try again shortly."
  return routeResult.ok({
    chunks: [],
    ...(!input.shouldLoadAll ? {
      pagination: { page: input.pageParams.page, pageSize: input.pageParams.pageSize, total: 0, totalPages: 0 },
    } : {}),
    message,
    ...(status === 409 ? { isProcessing: true } : { isUnavailable: true }),
  }, status)
}

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
    ...(input.pageParams.jobResultId ? { jobResultId: input.pageParams.jobResultId } : {}),
    ...(input.pageParams.chunkType ? { chunkType: input.pageParams.chunkType } : {}),
  })
  const pages = [firstPage]
  const jobResultId: string | undefined = input.pageParams.jobResultId ?? firstPage.jobResultId
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
        ...(jobResultId ? { jobResultId } : {}),
        ...(input.pageParams.chunkType ? { chunkType: input.pageParams.chunkType } : {}),
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

function filterChunksByType(
  chunks: readonly ParsedChunkView[],
  chunkType: ChunkReadType | undefined,
): ParsedChunkView[] {
  if (!chunkType) return [...chunks]
  return chunks.filter((chunk) => chunk.type === chunkType)
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
  return input.pageParams.jobResultId || displayReadUnavailable.isError(error)
    ? Effect.succeed(sourceChunksUnavailable(input))
    : Effect.fail(error)
}

export { createRouteChunks }
