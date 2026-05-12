import { Schema } from "effect"

import type { ArchiveSourceInput, JsonRouteResult } from "./route-types"
import { routeResult } from "@/lib/route-result"

type ArchiveSourceRequestInput = {
  readonly cookieHeader: string
  readonly request: Request
  readonly sourceId: string
}

type ArchiveSourceReadResult =
  | {
      readonly ok: true
      readonly input: ArchiveSourceInput
    }
  | {
      readonly ok: false
      readonly result: JsonRouteResult<{ readonly message: string }>
    }

type SourceRouteRequest = {
  readonly readArchiveSource: (
    input: ArchiveSourceRequestInput,
  ) => Promise<ArchiveSourceReadResult>
}

const ArchiveRequest = Schema.Struct({
  archived: Schema.Literal(true),
})

async function readArchiveSource({
  cookieHeader,
  request,
  sourceId,
}: ArchiveSourceRequestInput): Promise<ArchiveSourceReadResult> {
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
      cookieHeader,
      sourceId,
    },
  }
}

export const sourceRouteRequest: SourceRouteRequest = {
  readArchiveSource,
}
