import type { RetrievalQueryParams, RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { generateText } from "ai"
import { Effect, Either, Schema } from "effect"

import { CHAT_MODEL } from "./ai"
import type { Source } from "./schema"
import type { ChatCitationView } from "./types"

const DEFAULT_TOP_K = 8
const NO_RESULTS_ANSWER = "I couldn't find that in your sources."

export type RetrievalClient = {
  query(params: RetrievalQueryParams): Promise<{ results: RetrievalResult[] }>
}

export type GenerateAnswer = (input: {
  question: string
  results: readonly RetrievalResult[]
}) => Promise<string>

export type AnswerQuestionInput = {
  question: string
  namespace: string
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  retrieval: RetrievalClient
  generateAnswer: GenerateAnswer
}

export type AnswerQuestionResult = {
  answer: string
  citations: ChatCitationView[]
}

export type ParsedChatRequest = {
  question: string
  threadId?: string
  excludedSourceIds: string[]
}

export type ParseChatRequestResult =
  | { ok: true; value: ParsedChatRequest }
  | { ok: false; message: string; status: 400 }

export const answerQuestionWithRetrieval = (input: AnswerQuestionInput) =>
  Effect.gen(function* () {
    const query = input.question.trim()
    const response = yield* Effect.tryPromise(() =>
      input.retrieval.query({
        namespace: input.namespace,
        query,
        topK: DEFAULT_TOP_K,
        ...excludeDocuments(input.sources, input.excludedSourceIds),
      }),
    )

    if (response.results.length === 0) {
      return { answer: NO_RESULTS_ANSWER, citations: [] as ChatCitationView[] }
    }

    const answer = yield* Effect.tryPromise(() =>
      input.generateAnswer({
        question: query,
        results: response.results,
      }),
    )
    return {
      answer,
      citations: toChatCitationViews(response.results, answer),
    }
  })

export const generateGroundedAnswerEffect = (input: {
  question: string
  results: readonly RetrievalResult[]
}) =>
  Effect.gen(function* () {
    if (!process.env.AI_GATEWAY_API_KEY) {
      return yield* Effect.die(
        new Error(
          "AI_GATEWAY_API_KEY environment variable is required. " +
            "Set it in your .env.local file.",
        ),
      )
    }

    const response = yield* Effect.tryPromise(() =>
      generateText({
        model: CHAT_MODEL,
        prompt: buildGroundedPrompt(input),
      }),
    )
    return response.text.trim()
  })

/** Async wrapper matching the GenerateAnswer signature. */
export async function generateGroundedAnswer(input: {
  question: string
  results: readonly RetrievalResult[]
}): Promise<string> {
  return Effect.runPromise(generateGroundedAnswerEffect(input))
}

export function buildGroundedPrompt(input: {
  question: string
  results: readonly RetrievalResult[]
}): string {
  const sources = input.results
    .map((result, index) => {
      const sourceName = result.source.sourceFileName ?? "Unknown source"
      const section = result.source.sectionPath
        ? ` (${result.source.sectionPath})`
        : ""
      return [
        `[${index + 1}] ${sourceName}${section}`,
        result.content,
      ].join("\n")
    })
    .join("\n\n")

  return [
    "You are an assistant that answers questions from provided source excerpts.",
    "Your answer must be grounded only in the sources below. If they don't answer the question, say so directly.",
    "CITATION FORMAT: After each sourced statement include a brief citation label like [Source N: what the source says]. Use only the provided source numbers.",
    "",
    `Question: ${input.question}`,
    "",
    "Source excerpts:",
    sources,
  ].join("\n")
}

function toChatCitationViews(
  results: readonly RetrievalResult[],
  answer: string,
): ChatCitationView[] {
  const descriptionsBySourceNumber = getCitationDescriptions(answer)

  return results.map((result, index) => {
    const description = descriptionsBySourceNumber.get(index + 1)
    return {
      content: result.content,
      chunkType: result.chunkType,
      score: result.score,
      ...(result.assetUrl ? { assetUrl: result.assetUrl } : {}),
      ...(description ? { description } : {}),
      source: {
        documentId: result.source.documentId,
        sourceFileName: result.source.sourceFileName,
        sectionPath: result.source.sectionPath,
      },
    }
  })
}

function getCitationDescriptions(answer: string): Map<number, string> {
  const descriptions = new Map<number, string>()
  const citationPattern = /\[Source\s+(\d+)\s*:\s*([^\]]+)\]/gi
  let match: RegExpExecArray | null

  while ((match = citationPattern.exec(answer)) !== null) {
    const sourceNumber = Number(match[1])
    const description = match[2]?.trim()

    if (
      Number.isSafeInteger(sourceNumber) &&
      sourceNumber > 0 &&
      description &&
      !descriptions.has(sourceNumber)
    ) {
      descriptions.set(sourceNumber, description)
    }
  }

  return descriptions
}

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
      const excludedSourceIds = (parsed.excludedSourceIds ?? [])
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      return {
        ok: true,
        value: {
          question,
          threadId: parsed.threadId !== undefined && parsed.threadId.length > 0
            ? parsed.threadId
            : undefined,
          excludedSourceIds,
        },
      }
    },
  })
}

function excludeDocuments(
  sources: readonly Source[],
  excludedSourceIds: readonly string[],
): Pick<RetrievalQueryParams, "excludeDocumentIds"> {
  const excluded = new Set(excludedSourceIds)
  const documentIds = sources
    .filter((source) => excluded.has(source.id))
    .map((source) => source.knowhereDocumentId)
    .filter((documentId): documentId is string => Boolean(documentId))

  return documentIds.length > 0 ? { excludeDocumentIds: documentIds } : {}
}
