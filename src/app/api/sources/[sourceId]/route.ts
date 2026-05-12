import type { NextRequest, NextResponse } from "next/server"

import { sourceRouteRequest } from "@/domains/sources/route-request"
import { createSourceRouteService } from "@/domains/sources/route-service"
import { nextRouteContext } from "@/lib/next-route-context"
import { nextRouteResponse } from "@/lib/next-route-response"

type RouteContext = {
  params: Promise<{
    sourceId: string
  }>
}

const sourceRouteService = createSourceRouteService()

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { sourceId } = await context.params
  const routeContext = await nextRouteContext.read()
  const archiveRequest = await sourceRouteRequest.readArchiveSource({
    cookieHeader: routeContext.cookieHeader,
    request,
    sourceId,
  })
  if (!archiveRequest.ok) {
    return nextRouteResponse.toNextResponse(archiveRequest.result)
  }

  const result = await sourceRouteService.archiveSource({
    ...archiveRequest.input,
  })

  return nextRouteResponse.toNextResponse(result)
}
