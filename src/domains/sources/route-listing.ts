import { Effect } from "effect"

import { demoView } from "@/domains/demo/view"
import { resolveWorkspaceDemoSources } from "@/domains/demo/workspace-source-resolution"
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
  | "listSourcesForWorkspace"
  | "makeKnowhereClient"
> & {
  readonly demoApi: Pick<
    SourceRouteServiceDependencies["demoApi"],
    "fetchCatalog"
  >
  readonly sourceService: Pick<
    SourceRouteServiceDependencies["sourceService"],
    "listHiddenDemoSourceIds" | "listSelectedDemoSourceIds" | "listLegacyDemoDocumentIds" | "localizeRemoteDocument"
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
    const hiddenDemoSourceIds: ReadonlySet<string> = new Set(yield* Effect.tryPromise(() => deps.sourceService.listHiddenDemoSourceIds(workspace.id)))
    const selectedDemoSourceIds: ReadonlySet<string> = new Set(yield* Effect.tryPromise(() => deps.sourceService.listSelectedDemoSourceIds?.(workspace.id) ?? Promise.resolve([])))
    const demoSourceResolution = resolveWorkspaceDemoSources(sources, catalog, hiddenDemoSourceIds, selectedDemoSourceIds)
    const workspaceSources = demoSourceResolution.workspaceSources
    const excludedLegacyDocumentIds: ReadonlySet<string> = new Set(yield* Effect.tryPromise(() => deps.sourceService.listLegacyDemoDocumentIds?.(workspace.id) ?? Promise.resolve([])))
    const remoteSourceViews = yield* listRemoteLibrarySourceViews({
      workspace,
      client,
      localSources: sources,
      excludedDocumentIds: excludedLegacyDocumentIds,
    })
    yield* Effect.sync(() =>
      triggerBackgroundReconciliationForParsingSources({
        workspaceId: workspace.id,
        sources: workspaceSources,
        apiKey,
        startBackgroundReconciliation:
          deps.startBackgroundReconciliation ??
          defaultStartBackgroundReconciliation,
      }),
    )
    return routeResult.ok({
      sources: [
        ...demoSourceResolution.demoSources,
        ...workspaceSources.map((source) => toSourceView(source)),
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
