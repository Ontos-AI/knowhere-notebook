import "server-only"

import { NextResponse } from "next/server"

import { formatUnknownForLog } from "./format-log-value"
import { logger } from "./logger"

export async function withApiErrorResponse(
  context: string,
  handler: () => Promise<NextResponse>,
  fallbackMessage: string = "Something went wrong. Please try again.",
): Promise<NextResponse> {
  try {
    return await handler()
  } catch (error) {
    logger.error("api: unhandled request failure", {
      context,
      error: formatUnknownForLog(error),
    })
    return NextResponse.json({ message: fallbackMessage }, { status: 500 })
  }
}
