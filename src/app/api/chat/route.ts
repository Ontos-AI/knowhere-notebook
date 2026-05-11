import type { NextResponse } from "next/server"

import { chatRouteService } from "@/domains/chat/route-service"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function POST(request: Request): Promise<NextResponse> {
  const result = await chatRouteService.answerChat({
    body: await routeResult.readJsonOrNull(request),
  })

  return nextRouteResponse.toNextResponse(result)
}
