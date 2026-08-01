import { Either, Schema } from "effect"

import type { RetrievalOverrides } from "./contracts"

export type ParsedChatRequest = {
  question: string
  threadId?: string
  excludedSourceIds: string[]
  retrievalParams?: RetrievalOverrides
}

export type ParseChatRequestResult =
  | { ok: true; value: ParsedChatRequest }
  | { ok: false; message: string; status: 400 }

const ChatRetrievalParamsSchema = Schema.Struct({
  rerank: Schema.optional(Schema.Boolean),
  internalRecallK: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
})

const ChatRequestBody = Schema.Struct({
  message: Schema.String,
  threadId: Schema.optional(Schema.String),
  excludedSourceIds: Schema.optional(Schema.Array(Schema.Unknown)),
  retrievalParams: Schema.optional(ChatRetrievalParamsSchema),
})

const maxInternalRecallK = 50
const minInternalRecallK = 5
const maxTopK = 12
const minTopK = 1

export function parseChatRequestBody(body: unknown): ParseChatRequestResult {
  return Either.match(Schema.decodeUnknownEither(ChatRequestBody)(body), {
    onLeft: () => ({
      ok: false,
      message: "Enter a question before sending.",
      status: 400 as const,
    }),
    onRight: (parsed) => {
      const question = parsed.message.trim()
      if (question.length === 0) {
        return {
          ok: false,
          message: "Enter a question before sending.",
          status: 400 as const,
        }
      }
      const excludedSourceIds = (parsed.excludedSourceIds ?? []).filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      )
      return {
        ok: true,
        value: {
          question,
          threadId:
            parsed.threadId !== undefined && parsed.threadId.length > 0
              ? parsed.threadId
              : undefined,
          excludedSourceIds,
          ...(parsed.retrievalParams
            ? { retrievalParams: normalizeRetrievalParams(parsed.retrievalParams) }
            : {}),
        },
      }
    },
  })
}

function normalizeRetrievalParams(
  params: {
    readonly rerank?: boolean
    readonly internalRecallK?: number
    readonly topK?: number
  },
): RetrievalOverrides | undefined {
  let normalized: RetrievalOverrides | undefined

  if (typeof params.rerank === "boolean") {
    normalized = { ...normalized, rerank: params.rerank }
  }

  const internalRecallK = clampFinite(
    params.internalRecallK,
    minInternalRecallK,
    maxInternalRecallK,
  )
  if (internalRecallK !== undefined) {
    normalized = { ...normalized, internalRecallK }
  }

  const topK = clampFinite(params.topK, minTopK, maxTopK)
  if (topK !== undefined) {
    normalized = { ...normalized, topK }
  }

  return normalized
}

function clampFinite(
  value: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.min(Math.max(value, min), max)
}
