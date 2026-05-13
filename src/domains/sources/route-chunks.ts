import { Effect } from "effect"

import { demoView } from "@/domains/demo/view"
import type { DemoChunkPage } from "@/integrations/knowhere-demo"
import { logger } from "@/lib/logger"
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
  | "demoApi"
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
    return (await loadDemoChunkPage(input, deps)) ?? sourceNotFound()
  }

  const workspace = await deps.ensureWorkspace(user.id)
  const source = await deps.sourceService.findInWorkspace(
    workspace.id,
    input.sourceId,
  )

  if (!source) {
    return (await loadDemoChunkPage(input, deps)) ?? sourceNotFound()
  }

  if (source.demoKey) {
    return (await loadDemoChunkPage(input, deps, source.demoKey)) ?? sourceNotFound()
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

async function loadDemoChunkPage(
  input: LoadSourceChunksInput,
  deps: RouteChunksDependencies,
  demoSourceId: string = input.sourceId,
): Promise<JsonRouteResult<SourceChunksBody> | null> {
  try {
    const pages = input.shouldLoadAll
      ? await loadAllDemoChunkPages(input, deps, demoSourceId)
      : [
          await deps.demoApi.fetchChunkPage({
            demoSourceId,
            page: input.pageParams.page,
            pageSize: input.pageParams.pageSize,
          }),
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
      documentId: page.canonicalDocumentId,
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
  } catch (error) {
    logger.warn("sources: demo chunk load failed", {
      sourceId: input.sourceId,
      demoSourceId,
      page: input.pageParams.page,
      pageSize: input.pageParams.pageSize,
      shouldLoadAll: input.shouldLoadAll,
      knowhereBaseUrl: process.env.KNOWHERE_BASE_URL ?? "(default)",
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
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

function sourceNotFound(): JsonRouteResult<{ readonly message: string }> {
  return routeResult.error(404, "Source not found.")
}

export { createRouteChunks }
