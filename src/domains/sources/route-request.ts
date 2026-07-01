import { Schema } from "effect"

import type {
  ArchiveSourceInput,
  JsonRouteResult,
  RetrySourceInput,
} from "./route-types"
import { routeResult } from "@/lib/route-result"

type SourceMutationRequestInput = {
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

type SourceMutationReadResult =
  | {
      readonly ok: true
      readonly mutation:
        | {
            readonly kind: "archive"
            readonly input: ArchiveSourceInput
          }
        | {
            readonly kind: "retry"
            readonly input: RetrySourceInput
          }
    }
  | {
      readonly ok: false
      readonly result: JsonRouteResult<{ readonly message: string }>
    }

type SourceRouteRequest = {
  readonly readArchiveSource: (
    input: SourceMutationRequestInput,
  ) => Promise<ArchiveSourceReadResult>
  readonly readSourceMutation: (
    input: SourceMutationRequestInput,
  ) => Promise<SourceMutationReadResult>
}

const ArchiveRequest = Schema.Struct({
  archived: Schema.Literal(true),
})

const RetryRequest = Schema.Struct({
  retry: Schema.Literal(true),
})

async function readArchiveSource({
  cookieHeader,
  request,
  sourceId,
}: SourceMutationRequestInput): Promise<ArchiveSourceReadResult> {
  const result = await readSourceMutation({ cookieHeader, request, sourceId })
  if (!result.ok) return result
  if (result.mutation.kind !== "archive") {
    return {
      ok: false,
      result: routeResult.badRequest(
        "Request body must include `archived: true`.",
      ),
    }
  }

  return {
    ok: true,
    input: result.mutation.input,
  }
}

async function readSourceMutation({
  cookieHeader,
  request,
  sourceId,
}: SourceMutationRequestInput): Promise<SourceMutationReadResult> {
  const body = await routeResult.readJson(request)
  if (!body.ok) {
    return {
      ok: false,
      result: routeResult.badRequest("Invalid request body."),
    }
  }

  if (Schema.decodeUnknownEither(ArchiveRequest)(body.value)._tag === "Right") {
    return {
      ok: true,
      mutation: {
        kind: "archive",
        input: {
          cookieHeader,
          sourceId,
        },
      },
    }
  }

  if (Schema.decodeUnknownEither(RetryRequest)(body.value)._tag === "Right") {
    return {
      ok: true,
      mutation: {
        kind: "retry",
        input: {
          cookieHeader,
          sourceId,
        },
      },
    }
  }

  return {
    ok: false,
    result: routeResult.badRequest(
      "Request body must include `archived: true` or `retry: true`.",
    ),
  }
}

export const sourceRouteRequest: SourceRouteRequest = {
  readArchiveSource,
  readSourceMutation,
}
