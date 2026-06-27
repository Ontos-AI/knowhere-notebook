import { Effect } from "effect"

import { demoView } from "@/domains/demo/view"
import {
  getMaterializedDemoSourceViewOptionsBySourceId,
  getWorkspaceSourcesNeedingKnowhereChunkCount,
  resolveWorkspaceDemoSources,
} from "@/domains/demo/workspace-source-resolution"
import { routeResult } from "@/lib/route-result"
import { logger } from "@/lib/logger"
import { knowhereDemoApi } from "@/integrations/knowhere-demo"
import { toSourceView } from "./view"
import { startBackgroundReconciliation } from "./background-reconcile"
import { localizeRemoteLibrarySources } from "./remote-library"
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
    const sources = yield* Effect.tryPromise(() => {
      if (!hasParsingSources(listedSources)) {
        return Promise.resolve(listedSources)
      }
      return deps.reconcileSourcesForWorkspace(workspace, client)
    })
    const demoSourceResolution = resolveWorkspaceDemoSources(sources, catalog)
    const workspaceSources = yield* localizeRemoteLibrarySources({
      workspace,
      client,
      localSources: demoSourceResolution.workspaceSources,
      localizeDocument: (document) =>
        deps.sourceService.localizeRemoteDocument(workspace.id, document),
    })
    const sourcesNeedingKnowhereChunkCount =
      getWorkspaceSourcesNeedingKnowhereChunkCount(workspaceSources)
    const materializedDemoSourceOptions =
      getMaterializedDemoSourceViewOptionsBySourceId(workspaceSources, catalog)
    const parsingSources = sources.filter(
      (source) => source.status === "parsing" && source.knowhereJobId,
    )
    if (parsingSources.length > 0) {
      logger.info("route-listing: re-triggering reconciliation for parsing sources", {
        workspaceId: workspace.id,
        count: parsingSources.length,
        sourceIds: parsingSources.map((s) => s.id),
      })
    }
    for (const source of parsingSources) {
      yield* Effect.fork(
        Effect.tryPromise(() =>
          startBackgroundReconciliation(workspace.id, source.id, apiKey),
        ),
      )
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
        ...workspaceSources.map((source) =>
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

function hasParsingSources(
  sources: readonly {
    readonly status: string
    readonly knowhereJobId: string | null
  }[],
): boolean {
  return sources.some(
    (source) => source.status === "parsing" && source.knowhereJobId,
  )
}
