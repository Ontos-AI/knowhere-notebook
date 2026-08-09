import type { NextResponse } from "next/server"

import {
  generateChatDiagramSpec,
  parseChatDiagramRequestBody,
} from "@/domains/chat/diagram"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import { isAuthError } from "@/integrations/knowhere-credentials"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function POST(request: Request): Promise<NextResponse> {
  const body = parseChatDiagramRequestBody(
    await routeResult.readJsonOrNull(request),
  )
  if (!body.ok) {
    return nextRouteResponse.toNextResponse(
      routeResult.error(body.status, body.message),
    )
  }

  try {
    await notebookRequestContext.getAuthenticated()
    const diagram = await generateChatDiagramSpec({
      answer: body.value.answer,
    })
    return nextRouteResponse.toNextResponse(routeResult.ok({ diagram }))
  } catch (error) {
    const detail = summarizeUnknownError(error)
    const status = isAuthError({ message: detail }) ? 401 : 502
    logger.error("chat-diagram: generation failed", {
      status,
      detail,
    })
    return nextRouteResponse.toNextResponse(
      routeResult.error(status, `Diagram generation failed: ${detail}`),
    )
  }
}
