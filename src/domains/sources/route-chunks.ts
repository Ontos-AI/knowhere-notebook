import { Effect } from "effect"

import type { ChunkPage, ChunkPageParams } from "@/domains/chunks"
import type { ParsedChunkView } from "@/domains/chunks/types"
import { routeResult } from "@/lib/route-result"
import { getClientForWorkspace } from "./route-dependencies"
import type {
  JsonRouteResult,
  LoadSourceChunksInput,
  SourceChunksBody,
  SourceRouteServiceDependencies,
} from "./route-types"

type RouteChunksDependencies = Pick<
  SourceRouteServiceDependencies,
  | "demoData"
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
      loadSourceChunks(input, deps),
  }
}

async function loadSourceChunks(
  input: LoadSourceChunksInput,
  deps: RouteChunksDependencies,
): Promise<JsonRouteResult<SourceChunksBody>> {
  const user = await deps.getCurrentUser()
  if (!user) {
    const chunks = await deps.demoData.loadChunksForSource(input.sourceId)
    if (!chunks) return sourceNotFound()

    return routeResult.ok(
      input.shouldLoadAll
        ? { chunks }
        : toChunkPage(chunks, input.pageParams),
    )
  }

  const workspace = await deps.ensureWorkspace(user.id)
  const source = await deps.sourceService.findInWorkspace(
    workspace.id,
    input.sourceId,
  )

  if (!source) return sourceNotFound()

  const demoChunks = await deps.demoData.loadChunksForDocumentId(
    source.knowhereDocumentId,
  )
  if (demoChunks) {
    return routeResult.ok(
      input.shouldLoadAll
        ? { chunks: demoChunks }
        : toChunkPage(demoChunks, input.pageParams),
    )
  }

  const client = await getClientForWorkspace(
    workspace.id,
    input.cookieHeader,
    deps,
  )
  const assetUrlsByFilePath = await deps.sourceService.getParseAssetUrls(
    workspace.id,
    source.id,
  )

  if (input.shouldLoadAll) {
    const chunks = await Effect.runPromise(
      deps.loadChunksForSource(source, client, { assetUrlsByFilePath }),
    )
    return routeResult.ok({ chunks })
  }

  const chunkPage = await Effect.runPromise(
    deps.loadChunkPageForSource(source, client, input.pageParams, {
      assetUrlsByFilePath,
    }),
  )
  return routeResult.ok(chunkPage)
}

function sourceNotFound(): JsonRouteResult<{ readonly message: string }> {
  return routeResult.error(404, "Source not found.")
}

function toChunkPage(
  chunks: readonly ParsedChunkView[],
  params: ChunkPageParams,
): ChunkPage {
  const start = (params.page - 1) * params.pageSize
  const pageChunks = chunks.slice(start, start + params.pageSize)
  const totalPages =
    chunks.length === 0 ? 0 : Math.ceil(chunks.length / params.pageSize)

  return {
    chunks: pageChunks,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total: chunks.length,
      totalPages,
    },
  }
}

export { createRouteChunks }
