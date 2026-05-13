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
import { startBackgroundReconciliation } from "./background-reconcile"
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
  readonly demoApi: Pick<
    SourceRouteServiceDependencies["demoApi"],
    "fetchCatalog"
  >
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
    listSources: (input: ListSourcesInput) =>
      Effect.runPromise(listSourcesEffect(input, deps)),
  }
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const listSourcesEffect = (
  input: ListSourcesInput,
  deps: RouteListingDependencies,
) =>
  Effect.gen(function* () {
    const user = yield* Effect.tryPromise(() => deps.getCurrentUser())
    if (!user) {
      const catalog = yield* Effect.tryPromise(() => deps.demoApi.fetchCatalog())
      return routeResult.ok({
        sources: catalog.sources.map(demoView.toSourceView),
      })
    }

    const catalog = yield* Effect.tryPromise(() =>
      knowhereDemoApi.fetchOptionalCatalog(deps.demoApi.fetchCatalog),
    )
    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )
    const sources = yield* Effect.tryPromise(() =>
      deps.listSourcesForWorkspace(workspace.id),
    )
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
    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id, input.cookieHeader),
    )
    const client = deps.makeKnowhereClient(apiKey)
    for (const source of sources) {
      if (source.status === "parsing" && source.knowhereJobId) {
        yield* Effect.fork(
          Effect.tryPromise(() =>
            startBackgroundReconciliation(workspace.id, source.id, apiKey),
          ),
        )
      }
    }
    const sourceOptions = yield* deps.getSourceViewOptionsBySourceId(
      sourcesNeedingKnowhereChunkCount,
      client,
    )
    const hiddenDemoSourceIds = new Set(
      yield* Effect.tryPromise(() =>
        deps.sourceService.listHiddenDemoSourceIds(workspace.id),
      ),
    )
    const visibleDemoSources = catalog.sources
      .filter(
        (source) =>
          !demoSourceResolution.materializedDemoSourceIds.has(
            source.demoSourceId,
          ),
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
  })

export { createRouteListing }
