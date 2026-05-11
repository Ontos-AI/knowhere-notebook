import type { RetrievalQueryParams, RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { generateText } from "ai"
import { Effect, Either, Schema } from "effect"

import { CHAT_MODEL } from "@/lib/ai"
import type { Source } from "@/infrastructure/db/schema"
import type { ChatCitationView } from "@/domains/chat/types"

const DEFAULT_TOP_K = 8
const NO_RESULTS_ANSWER = "I couldn't find that in your sources."
const RECENT_CONTEXT_MESSAGE_LIMIT = 8
const CONTEXT_CONTENT_CHAR_LIMIT = 900
const RETRIEVAL_QUERY_CHAR_LIMIT = 600
const SOURCE_CONTEXT_LIMIT = 12

export type RetrievalClient = {
  query(params: RetrievalQueryParams): Promise<{ results: RetrievalResult[] }>
}

export type ChatHistoryMessage = {
  role: "user" | "assistant"
  content: string
  citations?: readonly ChatCitationView[]
}

export type GenerateRetrievalQuery = (input: {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
}) => Promise<string>

export type GenerateAnswer = (input: {
  question: string
  retrievalQuery: string
  messages: readonly ChatHistoryMessage[]
  results: readonly RetrievalResult[]
}) => Promise<string>

export type AnswerQuestionInput = {
  question: string
  namespace: string
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  retrieval: RetrievalClient
  generateRetrievalQuery: GenerateRetrievalQuery
  generateAnswer: GenerateAnswer
  messages: readonly ChatHistoryMessage[]
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
    const question = input.question.trim()
    const generatedQuery = yield* Effect.tryPromise(() =>
      input.generateRetrievalQuery({
        question,
        messages: input.messages,
        sources: input.sources,
        excludedSourceIds: input.excludedSourceIds,
      }),
    )
    const query = normalizeRetrievalQuery(generatedQuery, question)
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

    const results = useNotebookSourceTitles(response.results, input.sources)
    const answer = yield* Effect.tryPromise(() =>
      input.generateAnswer({
        question,
        retrievalQuery: query,
        messages: input.messages,
        results,
      }),
    )
    return {
      answer,
      citations: toChatCitationViews(results, answer),
    }
  })

export const generateContextualRetrievalQueryEffect = (input: {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
}) =>
  Effect.gen(function* () {
    const question = input.question.trim()
    if (input.messages.length === 0) return question

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
        prompt: buildRetrievalQueryPrompt({
          question,
          messages: input.messages,
          sources: input.sources,
          excludedSourceIds: input.excludedSourceIds,
        }),
      }),
    )
    return normalizeRetrievalQuery(response.text, question)
  })

/** Async wrapper matching the GenerateRetrievalQuery signature. */
export async function generateContextualRetrievalQuery(input: {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
}): Promise<string> {
  return Effect.runPromise(generateContextualRetrievalQueryEffect(input))
}

export const generateGroundedAnswerEffect = (input: {
  question: string
  retrievalQuery: string
  messages: readonly ChatHistoryMessage[]
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
  retrievalQuery: string
  messages: readonly ChatHistoryMessage[]
  results: readonly RetrievalResult[]
}): Promise<string> {
  return Effect.runPromise(generateGroundedAnswerEffect(input))
}

export function buildRetrievalQueryPrompt(input: {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
}): string {
  const sourceContext = formatSourceContext(input.sources, input.excludedSourceIds)
  const conversationContext = formatConversationContext(input.messages)

  return [
    "You prepare one search query for the Knowhere SDK retrieval API.",
    "Knowhere retrieval is stateless: it only sees the query string you return and does not know the chat history.",
    "Rewrite the user's latest question into a self-contained retrieval query by adding missing document, company, topic, date, or section context from the recent conversation.",
    "If the latest question already has enough context, keep it concise and close to the user's wording.",
    "Do not answer the question. Return only the retrieval query text.",
    "",
    "Searchable sources:",
    sourceContext,
    "",
    "Recent conversation:",
    conversationContext,
    "",
    `Latest user question: ${input.question}`,
    "",
    "Retrieval query:",
  ].join("\n")
}

export function buildGroundedPrompt(input: {
  question: string
  retrievalQuery?: string
  messages?: readonly ChatHistoryMessage[]
  results: readonly RetrievalResult[]
}): string {
  const retrievalQuery = input.retrievalQuery?.trim() || input.question
  const conversationContext = formatConversationContext(input.messages ?? [])
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
    "Use the recent conversation only to resolve references like \"this document\"; do not use it as factual evidence.",
    "CITATION FORMAT: After each sourced statement include a brief citation label like [Source N: what the source says]. Use only the provided source numbers.",
    "",
    `Question: ${input.question}`,
    `Retrieval query used: ${retrievalQuery}`,
    "",
    "Recent conversation:",
    conversationContext,
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

function useNotebookSourceTitles(
  results: readonly RetrievalResult[],
  sources: readonly Source[],
): RetrievalResult[] {
  const sourceTitlesByDocumentId = new Map(
    sources.flatMap((source): readonly [string, string][] =>
      source.knowhereDocumentId
        ? [[source.knowhereDocumentId, source.title]]
        : [],
    ),
  )

  return results.map((result): RetrievalResult => {
    const documentId = result.source.documentId
    const sourceTitle = documentId
      ? sourceTitlesByDocumentId.get(documentId)
      : undefined
    if (!sourceTitle) return result

    return {
      ...result,
      source: {
        ...result.source,
        sourceFileName: sourceTitle,
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

function normalizeRetrievalQuery(value: string, fallback: string): string {
  const firstContentLine = value
    .trim()
    .split(/\r?\n/)
    .map((line): string =>
      line
        .replace(/^\s*(?:retrieval\s+query|search\s+query|query)\s*:\s*/i, "")
        .trim(),
    )
    .find((line): boolean => line.length > 0)
  const withoutQuotes = stripWrappingQuotes(firstContentLine ?? "")
  const normalized = withoutQuotes.replace(/\s+/g, " ").trim()
  if (normalized.length === 0) return fallback
  return normalized.slice(0, RETRIEVAL_QUERY_CHAR_LIMIT)
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim()
  }
  return value
}

function formatSourceContext(
  sources: readonly Source[],
  excludedSourceIds: readonly string[],
): string {
  const excludedSourceIdsSet = new Set(excludedSourceIds)
  const lines = sources
    .filter((source): boolean => !excludedSourceIdsSet.has(source.id))
    .slice(0, SOURCE_CONTEXT_LIMIT)
    .map((source): string => {
      const documentId = source.knowhereDocumentId
        ? `documentId=${source.knowhereDocumentId}`
        : "documentId=unknown"
      return `- ${source.title} (${documentId})`
    })

  return lines.length > 0 ? lines.join("\n") : "- No searchable sources."
}

function formatConversationContext(
  messages: readonly ChatHistoryMessage[],
): string {
  const recentMessages = messages.slice(-RECENT_CONTEXT_MESSAGE_LIMIT)
  const lines = recentMessages.map((message): string => {
    const content = truncateContextText(message.content)
    const citationContext = formatCitationContext(message.citations ?? [])
    return citationContext
      ? `- ${message.role}: ${content}\n  citations: ${citationContext}`
      : `- ${message.role}: ${content}`
  })

  return lines.length > 0 ? lines.join("\n") : "- No prior messages."
}

function formatCitationContext(
  citations: readonly ChatCitationView[],
): string {
  const labels = citations
    .map((citation): string | null => {
      const sourceName = citation.source.sourceFileName
      const sectionPath = citation.source.sectionPath
      if (!sourceName && !sectionPath) return null
      return [sourceName, sectionPath].filter(Boolean).join(" / ")
    })
    .filter((label): label is string => label !== null)

  return Array.from(new Set(labels)).slice(0, 4).join("; ")
}

function truncateContextText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= CONTEXT_CONTENT_CHAR_LIMIT) return normalized
  return `${normalized.slice(0, CONTEXT_CONTENT_CHAR_LIMIT)}...`
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
