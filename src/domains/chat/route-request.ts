import { Schema } from "effect"

import type { ArchiveThreadInput } from "./route-threads"
import { routeResult, type RouteResult } from "@/lib/route-result"

type ArchiveThreadRequestInput = {
  readonly request: Request
  readonly threadId: string
}

type ArchiveThreadReadResult =
  | {
      readonly ok: true
      readonly input: ArchiveThreadInput
    }
  | {
      readonly ok: false
      readonly result: RouteResult<{ readonly message: string }>
    }

type ChatRouteRequest = {
  readonly readArchiveThread: (
    input: ArchiveThreadRequestInput,
  ) => Promise<ArchiveThreadReadResult>
}

const ArchiveRequest = Schema.Struct({
  archived: Schema.Literal(true),
})

async function readArchiveThread({
  request,
  threadId,
}: ArchiveThreadRequestInput): Promise<ArchiveThreadReadResult> {
  const body = await routeResult.readJson(request)
  if (!body.ok) {
    return {
      ok: false,
      result: routeResult.badRequest("Invalid request body."),
    }
  }

  if (Schema.decodeUnknownEither(ArchiveRequest)(body.value)._tag === "Left") {
    return {
      ok: false,
      result: routeResult.badRequest(
        "Request body must include `archived: true`.",
      ),
    }
  }

  return {
    ok: true,
    input: {
      threadId,
    },
  }
}

export const chatRouteRequest: ChatRouteRequest = {
  readArchiveThread,
}
