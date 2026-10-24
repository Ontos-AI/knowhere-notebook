import { Cause, Effect, Option, Runtime, Schema } from "effect"
import type { NextResponse } from "next/server"

import { demoView } from "@/domains/demo/view"
import { sourceService } from "@/domains/sources/service"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import { knowhereDemoApi } from "@/integrations/knowhere-demo"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"
import { logger } from "@/lib/logger"
import { formatUnknownForLog } from "@/lib/format-log-value"

const SelectionRequest = Schema.Struct({
  demoSourceIds: Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(Schema.minItems(1), Schema.maxItems(200)),
})

export function selectDemoSources(request: Request, shouldRestore: boolean): Promise<NextResponse> {
  return Effect.runPromise(Effect.gen(function* () {
    const body = yield* Effect.tryPromise(() => routeResult.readJson(request))
    if (!body.ok) return nextRouteResponse.toNextResponse(routeResult.badRequest("Invalid request body."))
    const decoded = Schema.decodeUnknownEither(SelectionRequest)(body.value)
    if (decoded._tag === "Left") return nextRouteResponse.toNextResponse(routeResult.badRequest("Select valid demo source IDs."))
    const demoSourceIds: readonly string[] = Array.from(new Set(decoded.right.demoSourceIds.map((id) => id.trim())))
    if (demoSourceIds.some((id) => id.length === 0)) return nextRouteResponse.toNextResponse(routeResult.badRequest("Select valid demo source IDs."))
    const context = yield* Effect.tryPromise(() => notebookRequestContext.getOptionalAuthenticated())
    if (!context) return nextRouteResponse.toNextResponse(routeResult.error(401, "Sign in to select demo sources."))
    const catalog = yield* Effect.tryPromise(() => knowhereDemoApi.fetchCatalog())
    const selectedSources = demoSourceIds.map((id) => catalog.sources.find((source) => source.demoSourceId === id))
    const missingSourceId: string | undefined = demoSourceIds.find((id) => !catalog.sources.some((source) => source.demoSourceId === id))
    if (missingSourceId) {
      const isPreparing: boolean = catalog.officialLibrary.sources.some((source) => source.demoSourceId === missingSourceId && source.status !== "ready") || (catalog.importStatuses ?? []).some((source) => source.demoSourceId === missingSourceId && source.status !== "ready")
      return nextRouteResponse.toNextResponse(routeResult.error(isPreparing ? 409 : 404, isPreparing ? "Selected demo source is still preparing." : "Selected demo source not found."))
    }
    const hiddenSourceIds: ReadonlySet<string> = shouldRestore ? new Set<string>() : new Set(yield* Effect.tryPromise(() => sourceService.listHiddenDemoSourceIds(context.workspace.id)))
    const sources = yield* Effect.all(selectedSources.flatMap((source) => {
      if (!source || hiddenSourceIds.has(source.demoSourceId)) return []
      return [Effect.gen(function* () {
        if (shouldRestore) yield* Effect.tryPromise(() => sourceService.restoreDemoSource(context.workspace.id, source.demoSourceId))
        return shouldRestore ? demoView.toSelectedSourceView(source) : demoView.toSourceView(source)
      })]
    }), { concurrency: 1 })
    return nextRouteResponse.toNextResponse(routeResult.ok({ sources }))
  }).pipe(Effect.catchAll((error) => {
    const status: number | undefined = readExpectedStatus(error)
    if (status !== undefined) return Effect.succeed(nextRouteResponse.toNextResponse(routeResult.error(status, getStatusMessage(status))))
    logger.error("Demo source selection failed", { operation: shouldRestore ? "selectDemoSources" : "readDemoSourceMetadata", error: formatUnknownForLog(error) })
    return Effect.succeed(nextRouteResponse.toNextResponse(routeResult.error(502, "Demo sources could not be loaded right now. Please try again.")))
  })))
}

function readExpectedStatus(error: unknown, depth: number = 0): number | undefined {
  if (depth > 8) return undefined
  if (Runtime.isFiberFailure(error)) {
    const failure = Cause.failureOption(error[Runtime.FiberFailureCauseId])
    return Option.isSome(failure) ? readExpectedStatus(failure.value, depth + 1) : undefined
  }
  if (typeof error !== "object" || error === null) return undefined
  if ("status" in error && typeof error.status === "number" && [401, 404, 409, 503].includes(error.status)) return error.status
  return "cause" in error ? readExpectedStatus(error.cause, depth + 1) : undefined
}

function getStatusMessage(status: number): string {
  if (status === 401) return "Sign in to select demo sources."
  if (status === 404) return "Selected demo source not found."
  if (status === 409) return "Selected demo source is still preparing. Please try again shortly."
  return "Demo sources are being prepared. Please try again shortly."
}
