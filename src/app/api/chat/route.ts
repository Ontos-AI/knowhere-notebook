import type { NextResponse } from "next/server"

import { chatAnswerRouteService } from "@/domains/chat/route-answer"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function POST(request: Request): Promise<NextResponse> {
  const result = await chatAnswerRouteService.answerChat({
    body: await routeResult.readJsonOrNull(request),
  })

  return nextRouteResponse.toNextResponse(result)
}
