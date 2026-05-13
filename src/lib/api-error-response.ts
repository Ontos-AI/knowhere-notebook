import "server-only"

import { Effect } from "effect"
import { NextResponse } from "next/server"

import { formatUnknownForLog } from "./format-log-value"
import { logger } from "./logger"

export async function withApiErrorResponse(
  context: string,
  handler: () => Promise<NextResponse>,
  fallbackMessage: string = "Something went wrong. Please try again.",
): Promise<NextResponse> {
  return Effect.runPromise(
    Effect.tryPromise(handler).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.error("api: unhandled request failure", {
            context,
            error: formatUnknownForLog(error),
          })
          return NextResponse.json(
            { message: fallbackMessage },
            { status: 500 },
          )
        }),
      ),
    ),
  )
}
