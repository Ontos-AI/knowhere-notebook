import { Effect } from "effect"

import { demoView } from "@/domains/demo/view"
import { resolveWorkspaceDemoSources } from "@/domains/demo/workspace-source-resolution"
import { routeResult } from "@/lib/route-result"
import type { DemoCatalog } from "@/integrations/knowhere-demo"
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

const emptyDemoCatalog: DemoCatalog = { sources: [] }

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

  const catalog = await fetchOptionalDemoCatalog(deps.demoApi.fetchCatalog)
  const workspace = await deps.ensureWorkspace(user.id)
  const client = await getClientForWorkspace(
    workspace.id,
    input.cookieHeader,
    deps,
  )
  const sources = await deps.reconcileSourcesForWorkspace(workspace, client)
  const demoSourceResolution = resolveWorkspaceDemoSources(sources, catalog)
  const sourceOptions = await Effect.runPromise(
    deps.getSourceViewOptionsBySourceId(
      demoSourceResolution.workspaceSources,
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
        toSourceView(source, sourceOptions.get(source.id)),
      ),
    ],
  })
}

async function fetchOptionalDemoCatalog(
  fetchDemoCatalog: () => Promise<DemoCatalog>,
): Promise<DemoCatalog> {
  try {
    return await fetchDemoCatalog()
  } catch {
    return emptyDemoCatalog
  }
}

export { createRouteListing }
