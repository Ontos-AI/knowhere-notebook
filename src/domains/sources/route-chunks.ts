import { Effect } from "effect"

import { demoView } from "@/domains/demo/view"
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
): Promise<JsonRouteResult<SourceChunksBody> | null> {
  try {
    const page = await deps.demoApi.fetchChunkPage({
      demoSourceId: input.sourceId,
      page: input.shouldLoadAll ? 1 : input.pageParams.page,
      pageSize: input.shouldLoadAll ? 200 : input.pageParams.pageSize,
    })
    const source = {
      id: page.demoSourceId,
      kind: "demo" as const,
      demoSourceId: page.demoSourceId,
      title: page.title,
      mimeType: page.mimeType,
      status: "ready" as const,
      documentId: page.canonicalDocumentId,
    }
    const chunks = page.chunks.map((chunk) =>
      demoView.toParsedChunkView(source, chunk),
    )

    return routeResult.ok(
      input.shouldLoadAll
        ? { chunks }
        : {
            chunks,
            pagination: page.pagination,
          },
    )
  } catch {
    return null
  }
}

function sourceNotFound(): JsonRouteResult<{ readonly message: string }> {
  return routeResult.error(404, "Source not found.")
}

export { createRouteChunks }
