import { Either, Schema } from "effect"

export type ParsedChatRequest = {
  question: string
  threadId?: string
  excludedSourceIds: string[]
}

export type ParseChatRequestResult =
  | { ok: true; value: ParsedChatRequest }
  | { ok: false; message: string; status: 400 }

const ChatRequestBody = Schema.Struct({
  message: Schema.String,
  threadId: Schema.optional(Schema.String),
  excludedSourceIds: Schema.optional(Schema.Array(Schema.Unknown)),
})

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
        },
      }
    },
  })
}
