import { Effect } from "effect"

import { demoView } from "@/domains/demo/view"
import {
  getMaterializedDemoSourceViewOptionsBySourceId,
  getWorkspaceSourcesNeedingChunkCount,
  resolveWorkspaceDemoSources,
} from "@/domains/demo/workspace-source-resolution"
import { routeResult } from "@/lib/route-result"
import { logger } from "@/lib/logger"
import { knowhereDemoApi } from "@/integrations/knowhere-demo"
import { toSourceView } from "./view"
import {
  startBackgroundReconciliation as defaultStartBackgroundReconciliation,
} from "./background-reconcile"
import { listRemoteLibrarySourceViews } from "./remote-library"
import type { Source } from "@/infrastructure/db/schema"
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
    "listHiddenDemoSourceIds" | "localizeRemoteDocument"
  >
  readonly reconcileSourcesForWorkspace: SourceRouteServiceDependencies[
    "reconcileSourcesForWorkspace"
  ]
  readonly startBackgroundReconciliation?: typeof defaultStartBackgroundReconciliation
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
    const listedSources = yield* Effect.tryPromise(() =>
      deps.listSourcesForWorkspace(workspace.id),
    )
    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id, input.cookieHeader),
    )
    const client = deps.makeKnowhereClient(apiKey)
    const sources = listedSources
    const demoSourceResolution = resolveWorkspaceDemoSources(sources, catalog)
    const workspaceSources = demoSourceResolution.workspaceSources
    const remoteSourceViews = yield* listRemoteLibrarySourceViews({
      workspace,
      client,
      localSources: demoSourceResolution.workspaceSources,
    })
    const sourcesNeedingChunkCount =
      getWorkspaceSourcesNeedingChunkCount(workspaceSources)
    const materializedDemoSourceOptions =
      getMaterializedDemoSourceViewOptionsBySourceId(workspaceSources, catalog)
    yield* Effect.sync(() =>
      triggerBackgroundReconciliationForParsingSources({
        workspaceId: workspace.id,
        sources,
        apiKey,
        startBackgroundReconciliation:
          deps.startBackgroundReconciliation ??
          defaultStartBackgroundReconciliation,
      }),
    )
    const sourceOptions = yield* deps.getSourceViewOptionsBySourceId(
      sourcesNeedingChunkCount,
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
        ...workspaceSources.map((source) =>
          toSourceView(
            source,
            materializedDemoSourceOptions.get(source.id) ??
              sourceOptions.get(source.id),
          ),
        ),
        ...remoteSourceViews,
      ],
    })
  })

export { createRouteListing }

function triggerBackgroundReconciliationForParsingSources(input: {
  readonly workspaceId: string
  readonly sources: readonly Source[]
  readonly apiKey: string
  readonly startBackgroundReconciliation: typeof defaultStartBackgroundReconciliation
}): void {
  const parsingSources = input.sources.filter(
    (source) => source.status === "parsing" && source.knowhereJobId,
  )
  if (parsingSources.length === 0) return

  logger.info("route-listing: re-triggering reconciliation for parsing sources", {
    workspaceId: input.workspaceId,
    count: parsingSources.length,
    sourceIds: parsingSources.map((source) => source.id),
  })

  for (const source of parsingSources) {
    void input
      .startBackgroundReconciliation(input.workspaceId, source.id, input.apiKey)
      .catch((error: unknown) => {
        logger.warn("route-listing: background reconciliation trigger failed", {
          workspaceId: input.workspaceId,
          sourceId: source.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }
}
