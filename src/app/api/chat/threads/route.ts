import type { NextResponse } from "next/server"

import { chatRouteService } from "@/domains/chat/route-service"
import { nextRouteResponse } from "@/lib/next-route-response"

export async function GET(): Promise<NextResponse> {
  return nextRouteResponse.toNextResponse(await chatRouteService.listThreads())
}

export async function POST(): Promise<NextResponse> {
  return nextRouteResponse.toNextResponse(await chatRouteService.createThread())
}
