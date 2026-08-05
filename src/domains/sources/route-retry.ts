import { Effect } from "effect"

import { routeResult } from "@/lib/route-result"
import { startBackgroundReconciliation } from "./background-reconcile"
import { toSourceView } from "./view"
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
>

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
    if (!workspace) {
      return routeResult.badRequest(
        "No workspace yet — pick a namespace from the dropdown.",
      )
    }

    const source = yield* Effect.tryPromise(() =>
      deps.sourceService.findInWorkspace(workspace.id, input.sourceId),
    )
    if (!source) {
      return routeResult.error(404, "Source not found.")
    }
    if (source.status !== "failed") {
      return routeResult.error(409, "Only failed sources can be retried.")
    }
    if (!source.originalBlobUrl || !source.originalBlobPathname) {
      return routeResult.error(
        409,
        "This source cannot be retried because its original file is unavailable.",
      )
    }

    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id),
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

export { createRouteRetry }
