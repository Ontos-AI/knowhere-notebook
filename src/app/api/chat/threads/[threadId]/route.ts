import type { NextRequest, NextResponse } from "next/server"

import { chatRouteRequest } from "@/domains/chat/route-request"
import { chatThreadRouteService } from "@/domains/chat/route-threads"
import { nextRouteResponse } from "@/lib/next-route-response"

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
    await chatThreadRouteService.getThread({
      threadId,
    }),
  )
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { threadId } = await context.params
  const archiveRequest = await chatRouteRequest.readArchiveThread({
    request,
    threadId,
  })
  if (!archiveRequest.ok) {
    return nextRouteResponse.toNextResponse(archiveRequest.result)
  }

  return nextRouteResponse.toNextResponse(
    await chatThreadRouteService.archiveThread(archiveRequest.input),
  )
}
