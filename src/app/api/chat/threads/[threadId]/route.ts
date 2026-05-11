import type { NextRequest, NextResponse } from "next/server"

import { chatRouteService } from "@/domains/chat/route-service"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

type RouteContext = {
  params: Promise<{
    threadId: string
  }>
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { threadId } = await context.params

  return nextRouteResponse.toNextResponse(
    await chatRouteService.getThread({
      threadId,
    }),
  )
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { threadId } = await context.params
  const body = await routeResult.readJson(request)
  if (!body.ok) {
    return nextRouteResponse.toNextResponse(
      routeResult.badRequest("Invalid request body."),
    )
  }

  return nextRouteResponse.toNextResponse(
    await chatRouteService.archiveThread({
      threadId,
      body: body.value,
    }),
  )
}
