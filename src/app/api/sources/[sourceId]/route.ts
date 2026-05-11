import type { NextRequest, NextResponse } from "next/server"
import { Schema } from "effect"

import { createSourceRouteService } from "@/domains/sources/route-service"
import { nextRouteContext } from "@/lib/next-route-context"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

type RouteContext = {
  params: Promise<{
    sourceId: string
  }>
}

const ArchiveRequest = Schema.Struct({
  archived: Schema.Literal(true),
})

const sourceRouteService = createSourceRouteService()

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { sourceId } = await context.params

  const body = await routeResult.readJson(request)
  if (!body.ok) {
    return nextRouteResponse.toNextResponse(
      routeResult.badRequest("Invalid request body."),
    )
  }

  if (Schema.decodeUnknownEither(ArchiveRequest)(body.value)._tag === "Left") {
    return nextRouteResponse.toNextResponse(
      routeResult.badRequest("Request body must include `archived: true`."),
    )
  }

  const routeContext = await nextRouteContext.read()
  const result = await sourceRouteService.archiveSource({
    cookieHeader: routeContext.cookieHeader,
    sourceId,
  })

  return nextRouteResponse.toNextResponse(result)
}
