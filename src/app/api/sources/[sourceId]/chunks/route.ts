import type { NextRequest, NextResponse } from "next/server"

import {
  getChunkPageParams,
} from "@/domains/chunks"
import { createSourceRouteService } from "@/domains/sources/route-service"
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
  const { sourceId } = await context.params
  const shouldLoadAll =
    !request.nextUrl.searchParams.has("page") &&
    !request.nextUrl.searchParams.has("pageSize")
  const pageParams = getChunkPageParams(request.nextUrl.searchParams)
  const routeContext = await nextRouteContext.read()
  const result = await sourceRouteService.loadSourceChunks({
    cookieHeader: routeContext.cookieHeader,
    pageParams,
    shouldLoadAll,
    sourceId,
  })

  return nextRouteResponse.toNextResponse(result)
}
