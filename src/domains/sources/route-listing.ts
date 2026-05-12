import { Effect } from "effect"

import { demoView } from "@/domains/demo/view"
import { routeResult } from "@/lib/route-result"
import { toSourceView } from "./view"
import { getClientForWorkspace } from "./route-dependencies"
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
  | "makeKnowhereClient"
  | "reconcileSourcesForWorkspace"
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
  const catalog = await deps.demoApi.fetchCatalog()
  if (!user) {
    return routeResult.ok({ sources: catalog.sources.map(demoView.toSourceView) })
  }

  const workspace = await deps.ensureWorkspace(user.id)
  const client = await getClientForWorkspace(
    workspace.id,
    input.cookieHeader,
    deps,
  )
  const sources = await deps.reconcileSourcesForWorkspace(workspace, client)
  const sourceOptions = await Effect.runPromise(
    deps.getSourceViewOptionsBySourceId(sources, client),
  )
  const materializedDemoSourceIds = new Set(
    sources
      .map((source) => source.demoKey)
      .filter((demoSourceId): demoSourceId is string => Boolean(demoSourceId)),
  )
  const hiddenDemoSourceIds = new Set(
    await deps.sourceService.listHiddenDemoSourceIds(workspace.id),
  )
  const visibleDemoSources = catalog.sources
    .filter((source) => !materializedDemoSourceIds.has(source.demoSourceId))
    .filter((source) => !hiddenDemoSourceIds.has(source.demoSourceId))
    .map(demoView.toSourceView)

  return routeResult.ok({
    sources: [
      ...visibleDemoSources,
      ...sources.map((source) =>
        toSourceView(source, sourceOptions.get(source.id)),
      ),
    ],
  })
}

export { createRouteListing }
