import { Effect } from "effect"

import { logger } from "@/lib/logger"
import { routeResult } from "@/lib/route-result"
import { startBackgroundReconciliation } from "./background-reconcile"
import { enqueueParsedDocumentSync } from "./parsed-document-sync-scheduler"
import { sourceWorkflowRuntime } from "./workflow-runtime"
import { toSourceView } from "./view"
import type { Source, Workspace } from "@/infrastructure/db/schema"
import type {
  JsonRouteResult,
  RetrySourceBody,
  RetrySourceInput,
  SourceRouteServiceDependencies,
} from "./route-types"

type RouteRetryDependencies = Pick<
  SourceRouteServiceDependencies,
  | "ensureApiKeyForWorkspace"
  | "ensureWorkspace"
  | "makeKnowhereClient"
  | "requireUser"
  | "sourceService"
> & {
  readonly resumeParsedSync?: typeof resumeParsedSync
}

type RouteRetry = {
  readonly retrySource: (
    input: RetrySourceInput,
  ) => Promise<JsonRouteResult<RetrySourceBody>>
}

function createRouteRetry(deps: RouteRetryDependencies): RouteRetry {
  return {
    retrySource: (input: RetrySourceInput) =>
      Effect.runPromise(retrySourceEffect(input, deps)),
  }
}

const retrySourceEffect = (
  input: RetrySourceInput,
  deps: RouteRetryDependencies,
) =>
  Effect.gen(function* () {
    const user = yield* Effect.tryPromise(() => deps.requireUser())
    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )

    const source = yield* Effect.tryPromise(() =>
      deps.sourceService.findInWorkspace(workspace.id, input.sourceId),
    )
    if (!source) {
      return routeResult.error(404, "Source not found.")
    }
    if (source.status !== "failed") {
      return routeResult.error(409, "Only failed sources can be retried.")
    }

    // A storage-sync failure keeps the parsed Knowhere document intact — resume
    // the parsed-document sync from the stored revision instead of reparsing.
    if (source.failureStage === "storage_sync" && source.knowhereDocumentId) {
      const apiKey = yield* Effect.tryPromise(() =>
        deps.ensureApiKeyForWorkspace(workspace.id, input.cookieHeader),
      )
      const resumedSource = yield* Effect.tryPromise(() =>
        (deps.resumeParsedSync ?? resumeParsedSync)({
          workspace,
          source,
          apiKey,
        }),
      )
      return routeResult.ok({ source: toSourceView(resumedSource) })
    }

    if (!source.originalBlobUrl || !source.originalBlobPathname) {
      return routeResult.error(
        409,
        "This source cannot be retried because its original file is unavailable.",
      )
    }

    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id, input.cookieHeader),
    )
    const client = deps.makeKnowhereClient(apiKey)
    const retriedSource = yield* Effect.tryPromise(() =>
      deps.sourceService.retrySourceToKnowhere(workspace, source, client),
    )

    if (retriedSource.status === "parsing") {
      yield* Effect.tryPromise(() =>
        startBackgroundReconciliation(workspace.id, retriedSource.id, apiKey),
      )
    }

    return routeResult.ok({ source: toSourceView(retriedSource) })
  })

/**
 * Resume a parsed-document storage sync that failed after a successful parse.
 * Moves the source back to `parsing` (clearing the failure stage), resets the
 * sync status, and re-enqueues the resumable parsed-sync workflow from the
 * stored document + revision — no reparse.
 */
async function resumeParsedSync(input: {
  readonly workspace: Workspace
  readonly source: Source
  readonly apiKey: string
}): Promise<Source> {
  const { workspace, source, apiKey } = input
  const documentId = source.knowhereDocumentId
  if (!documentId) return source

  const revisionKey = source.knowhereJobId ?? undefined
  const parsingSource = await sourceWorkflowRuntime.markParsing(
    workspace.id,
    source.id,
    revisionKey ?? documentId,
    documentId,
    "failed",
  )
  if (!parsingSource) return source

  await sourceWorkflowRuntime.updateSyncStatus(workspace.id, source.id, {
    revisionKey,
    syncStatus: "running",
    syncError: null,
  })
  await enqueueParsedDocumentSync({
    workspaceId: workspace.id,
    sourceId: source.id,
    documentId,
    apiKey,
    revisionKey,
  })
  logger.info("sources: resumed parsed document storage sync on retry", {
    workspaceId: workspace.id,
    sourceId: source.id,
    documentId,
    revisionKey,
  })
  return parsingSource
}

export { createRouteRetry, resumeParsedSync }
