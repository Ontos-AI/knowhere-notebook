import { NextResponse } from "next/server"

import { chatRouteService } from "@/domains/chat/route-service"

type RouteServiceResponse = {
  readonly status: number
  readonly body: unknown
}

export async function GET(): Promise<NextResponse> {
  return toNextResponse(await chatRouteService.listThreads())
}

export async function POST(): Promise<NextResponse> {
  return toNextResponse(await chatRouteService.createThread())
}

function toNextResponse(result: RouteServiceResponse): NextResponse {
  return NextResponse.json(result.body, { status: result.status })
}
