import { Effect } from "effect"

import { routeResult } from "@/lib/route-result"
import { logger } from "@/lib/logger"
import { toSourceView } from "./view"
import {
  startBackgroundReconciliation as defaultStartBackgroundReconciliation,
} from "./background-reconcile"
import { localizeRemoteLibrarySources } from "./remote-library"
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
  readonly sourceService: Pick<
    SourceRouteServiceDependencies["sourceService"],
    "localizeRemoteDocument"
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
      return routeResult.ok({ sources: [] })
    }

    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )
    if (!workspace) {
      return routeResult.ok({ sources: [] })
    }
    const listedSources = yield* Effect.tryPromise(() =>
      deps.listSourcesForWorkspace(workspace.id),
    )
    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id),
    )
    const client = deps.makeKnowhereClient(apiKey)
    const sources = listedSources
    const workspaceSources = sources
    const localizedSources = yield* localizeRemoteLibrarySources({
      workspace,
      client,
      localSources: workspaceSources,
      localizeDocument: (document) =>
        deps.sourceService.localizeRemoteDocument(workspace.id, {
          documentId: document.documentId,
          namespace: document.namespace,
          status: document.status,
          title: document.title,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          revisionKey: document.revisionKey ?? null,
        }),
    })
    const sourcesNeedingKnowhereChunkCount =
      getWorkspaceSourcesNeedingKnowhereChunkCount(localizedSources)
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
      sourcesNeedingKnowhereChunkCount,
      client,
    )

    return routeResult.ok({
      sources: localizedSources.map((source) =>
        toSourceView(source, sourceOptions.get(source.id)),
      ),
    })
  })

export { createRouteListing }

function getWorkspaceSourcesNeedingKnowhereChunkCount(
  sources: readonly Source[],
): readonly Source[] {
  return sources.filter(
    (source) => source.status === "ready" && source.knowhereDocumentId,
  )
}

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
