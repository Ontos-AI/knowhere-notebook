import type { NextResponse } from "next/server"

import { chatThreadRouteService } from "@/domains/chat/route-threads"
import { nextRouteResponse } from "@/lib/next-route-response"

export async function GET(): Promise<NextResponse> {
  return nextRouteResponse.toNextResponse(
    await chatThreadRouteService.listThreads(),
  )
}

export async function POST(): Promise<NextResponse> {
  return nextRouteResponse.toNextResponse(
    await chatThreadRouteService.createThread(),
  )
}
