import { Effect } from "effect"

import { demoView } from "@/domains/demo/view"
import {
  getMaterializedDemoSourceViewOptionsBySourceId,
  getWorkspaceSourcesNeedingKnowhereChunkCount,
  resolveWorkspaceDemoSources,
} from "@/domains/demo/workspace-source-resolution"
import { routeResult } from "@/lib/route-result"
import { knowhereDemoApi } from "@/integrations/knowhere-demo"
import { toSourceView } from "./view"
import { reconcileStaleSources } from "./background-reconcile"
import type {
  JsonRouteResult,
  ListSourcesBody,
  ListSourcesInput,
  SourceRouteServiceDependencies,
} from "./route-types"

type RouteListingDependencies = Pick<
  SourceRouteServiceDependencies,
  | "ensureApiKeyForWorkspace"
  | "ensureWorkspace"
  | "getCurrentUser"
  | "getSourceViewOptionsBySourceId"
  | "listSourcesForWorkspace"
  | "makeKnowhereClient"
> & {
  readonly demoApi: Pick<SourceRouteServiceDependencies["demoApi"], "fetchCatalog">
  readonly sourceService: Pick<
    SourceRouteServiceDependencies["sourceService"],
    "listHiddenDemoSourceIds"
  >
}

type RouteListing = {
  readonly listSources: (
    input: ListSourcesInput,
  ) => Promise<JsonRouteResult<ListSourcesBody>>
}

function createRouteListing(deps: RouteListingDependencies): RouteListing {
  return {
    listSources: (input: ListSourcesInput) => listSources(input, deps),
  }
}

async function listSources(
  input: ListSourcesInput,
  deps: RouteListingDependencies,
): Promise<JsonRouteResult<ListSourcesBody>> {
  const user = await deps.getCurrentUser()
  if (!user) {
    const catalog = await deps.demoApi.fetchCatalog()
    return routeResult.ok({ sources: catalog.sources.map(demoView.toSourceView) })
  }

  const catalog = await knowhereDemoApi.fetchOptionalCatalog(deps.demoApi.fetchCatalog)
  const workspace = await deps.ensureWorkspace(user.id)
  const sources = await deps.listSourcesForWorkspace(workspace.id)
  const demoSourceResolution = resolveWorkspaceDemoSources(sources, catalog)
  const sourcesNeedingKnowhereChunkCount =
    getWorkspaceSourcesNeedingKnowhereChunkCount(
      demoSourceResolution.workspaceSources,
    )
  const materializedDemoSourceOptions =
    getMaterializedDemoSourceViewOptionsBySourceId(
      demoSourceResolution.workspaceSources,
      catalog,
    )
  const apiKey = await deps.ensureApiKeyForWorkspace(
    workspace.id,
    input.cookieHeader,
  )
  const client = deps.makeKnowhereClient(apiKey)
  void reconcileStaleSources(workspace.id, apiKey)
  const sourceOptions = await Effect.runPromise(
    deps.getSourceViewOptionsBySourceId(
      sourcesNeedingKnowhereChunkCount,
      client,
    ),
  )
  const hiddenDemoSourceIds = new Set(
    await deps.sourceService.listHiddenDemoSourceIds(workspace.id),
  )
  const visibleDemoSources = catalog.sources
    .filter(
      (source) =>
        !demoSourceResolution.materializedDemoSourceIds.has(source.demoSourceId),
    )
    .filter((source) => !hiddenDemoSourceIds.has(source.demoSourceId))
    .map(demoView.toSourceView)

  return routeResult.ok({
    sources: [
      ...visibleDemoSources,
      ...demoSourceResolution.workspaceSources.map((source) =>
        toSourceView(
          source,
          materializedDemoSourceOptions.get(source.id) ??
            sourceOptions.get(source.id),
        ),
      ),
    ],
  })
}

export { createRouteListing }
