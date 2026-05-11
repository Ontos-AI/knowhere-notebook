import { Effect } from "effect"

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
  readonly demoData: Pick<
    SourceRouteServiceDependencies["demoData"],
    "listSources"
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
    return routeResult.ok({ sources: deps.demoData.listSources() })
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

  return routeResult.ok({
    sources: sources.map((source) =>
      toSourceView(source, sourceOptions.get(source.id)),
    ),
  })
}

export { createRouteListing }
