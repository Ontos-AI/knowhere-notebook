import "server-only"

import { Effect } from "effect"
import { NextResponse } from "next/server"

import { effectOperation } from "./effect-operation"
import { formatUnknownForLog } from "./format-log-value"
import { logger } from "./logger"

export async function withApiErrorResponse(
  context: string,
  handler: () => Promise<NextResponse>,
  fallbackMessage: string = "Something went wrong. Please try again.",
): Promise<NextResponse> {
  return Effect.runPromise(
    effectOperation.tryPromise(
      {
        context: "API request",
        operation: context,
      },
      handler,
    ).pipe(
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
