import type { NextRequest, NextResponse } from "next/server"

import { getChunkPageParams } from "@/domains/chunks"
import { createSourceRouteService } from "@/domains/sources/route-service"
import { withApiErrorResponse } from "@/lib/api-error-response"
import { nextRouteContext } from "@/lib/next-route-context"
import { nextRouteResponse } from "@/lib/next-route-response"

type RouteContext = {
  params: Promise<{
    sourceId: string
  }>
}

const sourceRouteService = createSourceRouteService()

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  return withApiErrorResponse("sources:page-assets", async () => {
    const { sourceId } = await context.params
    const routeContext = await nextRouteContext.read()
    const result = await sourceRouteService.loadSourcePageAssets({
      cookieHeader: routeContext.cookieHeader,
      pageParams: getChunkPageParams(request.nextUrl.searchParams),
      sourceId,
    })

    return nextRouteResponse.toNextResponse(result)
  })
}
