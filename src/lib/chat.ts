import type {
  DocumentChunk,
  RetrievalQueryParams,
  RetrievalResult,
} from "@ontos-ai/knowhere-sdk"
import { generateText } from "ai"
import { Effect, Either, Schema } from "effect"

import { CHAT_MODEL } from "./ai"
import type { Source } from "./schema"
import type { ChatCitationView } from "./types"

const DEFAULT_TOP_K = 8
const NO_RESULTS_ANSWER = "I couldn't find that in your sources."
const RECENT_CONTEXT_MESSAGE_LIMIT = 8
const CONTEXT_CONTENT_CHAR_LIMIT = 900
const RETRIEVAL_QUERY_CHAR_LIMIT = 600
const SOURCE_CONTEXT_LIMIT = 12
const DOCUMENT_CHUNK_PAGE_SIZE = 200
const DOCUMENT_COUNT_DESCRIPTION = "whole document keyword count"

export type RetrievalClient = {
  query(params: RetrievalQueryParams): Promise<{ results: RetrievalResult[] }>
}

export type DocumentChunksClient = {
  documents: {
    listChunks(
      documentId: string,
      params: {
        page: number
        pageSize: number
        includeAssetUrls: boolean
      },
    ): Promise<{
      chunks: DocumentChunk[]
      pagination?: {
        totalPages?: number
      }
    }>
  }
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
  documentChunks?: DocumentChunksClient
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
    const documentCountAnswer = yield* answerDocumentKeywordCountQuestion({
      question,
      sources: input.sources,
      excludedSourceIds: input.excludedSourceIds,
      messages: input.messages,
      documentChunks: input.documentChunks,
    })
    if (documentCountAnswer) return documentCountAnswer

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
    const results = toUserVisibleRetrievalResults(response.results, input.sources)

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
    const description = normalizeCitationDescription(
      descriptionsBySourceNumber.get(index + 1),
      result,
    )
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

function toUserVisibleRetrievalResults(
  results: readonly RetrievalResult[],
  sources: readonly Source[],
): RetrievalResult[] {
  const sourceTitleByDocumentId = new Map(
    sources
      .filter((source) => source.knowhereDocumentId && source.title)
      .map((source) => [source.knowhereDocumentId!, source.title]),
  )

  return results.map((result): RetrievalResult => {
    const sourceTitle = result.source.documentId
      ? sourceTitleByDocumentId.get(result.source.documentId)
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

function normalizeCitationDescription(
  description: string | undefined,
  result: RetrievalResult,
): string | undefined {
  const normalized = description?.trim()
  if (!normalized) return undefined

  const duplicateCandidates = [
    result.source.sourceFileName,
    result.source.sectionPath,
  ]
  const isDuplicate = duplicateCandidates.some(
    (candidate): boolean =>
      typeof candidate === "string" &&
      candidate.trim().toLowerCase() === normalized.toLowerCase(),
  )
  return isDuplicate ? undefined : normalized
}

function answerDocumentKeywordCountQuestion(input: {
  question: string
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  messages: readonly ChatHistoryMessage[]
  documentChunks?: DocumentChunksClient
}) {
  return Effect.gen(function* () {
    if (!input.documentChunks) return null

    const request = parseDocumentKeywordCountQuestion(input.question)
    if (!request) return null

    const source = resolveDocumentKeywordCountSource({
      question: input.question,
      sources: input.sources,
      excludedSourceIds: input.excludedSourceIds,
      messages: input.messages,
    })
    if (!source?.knowhereDocumentId) return null

    const chunks = yield* loadAllDocumentChunks(
      input.documentChunks,
      source.knowhereDocumentId,
    )
    const countResult = countKeywordOccurrences(chunks, request.keyword)
    const answer = formatDocumentKeywordCountAnswer({
      keyword: request.keyword,
      count: countResult.count,
      sourceTitle: source.title,
    })

    return {
      answer,
      citations: [
        {
          content: countResult.firstMatchingChunk?.content ?? undefined,
          chunkType: countResult.firstMatchingChunk?.chunkType ?? "text",
          score: 1,
          description: DOCUMENT_COUNT_DESCRIPTION,
          source: {
            documentId: source.knowhereDocumentId,
            sourceFileName: source.title,
            sectionPath: countResult.firstMatchingChunk?.sectionPath ?? undefined,
          },
        },
      ],
    } satisfies AnswerQuestionResult
  })
}

function parseDocumentKeywordCountQuestion(
  question: string,
): { keyword: string } | null {
  const quotedKeyword = /["'“”‘’]([^"'“”‘’]{1,80})["'“”‘’]/u.exec(question)
  const keyword = quotedKeyword?.[1]?.trim()
  if (!keyword) return null

  const hasCountIntent =
    /\b(?:how many|count|number of|occurrences?|appears?|appeared|times)\b/iu.test(
      question,
    ) ||
    /\b(?:keyword|keywords|word|words|term|terms|occurrence|occurrences)\b/iu.test(
      question,
    )
  if (!hasCountIntent) return null

  return { keyword }
}

function resolveDocumentKeywordCountSource(input: {
  question: string
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  messages: readonly ChatHistoryMessage[]
}): Source | null {
  const includedSources = getIncludedReadySources(
    input.sources,
    input.excludedSourceIds,
  )
  if (includedSources.length === 0) return null

  const mentionedSource = findQuestionMentionedSource(
    input.question,
    includedSources,
  )
  if (mentionedSource) return mentionedSource

  const recentSource = findRecentCitedSource(input.messages, includedSources)
  if (recentSource) return recentSource

  return includedSources.length === 1 ? includedSources[0]! : null
}

function getIncludedReadySources(
  sources: readonly Source[],
  excludedSourceIds: readonly string[],
): Source[] {
  const excludedSourceIdsSet = new Set(excludedSourceIds)
  return sources.filter(
    (source): source is Source & { knowhereDocumentId: string } =>
      source.status === "ready" &&
      typeof source.knowhereDocumentId === "string" &&
      source.knowhereDocumentId.length > 0 &&
      !excludedSourceIdsSet.has(source.id),
  )
}

function findQuestionMentionedSource(
  question: string,
  sources: readonly Source[],
): Source | null {
  const normalizedQuestion = normalizeSourceMatchText(question)
  return (
    sources.find((source): boolean =>
      getSourceMatchCandidates(source).some((candidate): boolean =>
        normalizedQuestion.includes(candidate),
      ),
    ) ?? null
  )
}

function getSourceMatchCandidates(source: Source): string[] {
  const title = source.title.trim()
  const titleWithoutExtension = title.replace(/\.[^.]+$/u, "")
  return [title, titleWithoutExtension, source.knowhereDocumentId ?? ""]
    .map(normalizeSourceMatchText)
    .filter((candidate): boolean => candidate.length >= 3)
}

function normalizeSourceMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
}

function findRecentCitedSource(
  messages: readonly ChatHistoryMessage[],
  sources: readonly Source[],
): Source | null {
  const sourceByDocumentId = new Map(
    sources.map((source) => [source.knowhereDocumentId, source]),
  )

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    const citations = message?.citations ?? []
    for (let j = citations.length - 1; j >= 0; j -= 1) {
      const documentId = citations[j]?.source.documentId
      const source = documentId ? sourceByDocumentId.get(documentId) : undefined
      if (source) return source
    }
  }

  return null
}

function loadAllDocumentChunks(
  client: DocumentChunksClient,
  documentId: string,
) {
  return Effect.gen(function* () {
    const chunks: DocumentChunk[] = []
    let page = 1
    let totalPages = 1

    do {
      const response = yield* Effect.tryPromise(() =>
        client.documents.listChunks(documentId, {
          page,
          pageSize: DOCUMENT_CHUNK_PAGE_SIZE,
          includeAssetUrls: false,
        }),
      )
      chunks.push(...response.chunks)
      totalPages = getDocumentChunkTotalPages(response.pagination)
      page += 1
    } while (page <= totalPages)

    return chunks
  })
}

function getDocumentChunkTotalPages(
  pagination:
    | {
        totalPages?: number
      }
    | undefined,
): number {
  const totalPages = pagination?.totalPages
  return typeof totalPages === "number" && Number.isFinite(totalPages)
    ? Math.max(1, totalPages)
    : 1
}

function countKeywordOccurrences(
  chunks: readonly DocumentChunk[],
  keyword: string,
): { count: number; firstMatchingChunk?: DocumentChunk } {
  const keywordPattern = buildKeywordPattern(keyword)
  let count = 0
  let firstMatchingChunk: DocumentChunk | undefined

  for (const chunk of chunks) {
    const content = chunk.content ?? ""
    const matches = content.match(keywordPattern)
    if (!matches) continue

    count += matches.length
    firstMatchingChunk ??= chunk
  }

  return { count, firstMatchingChunk }
}

function buildKeywordPattern(keyword: string): RegExp {
  const escapedKeyword = escapeRegExp(keyword)
  if (/^[a-z0-9_]+$/iu.test(keyword)) {
    return new RegExp(`\\b${escapedKeyword}\\b`, "giu")
  }
  return new RegExp(escapedKeyword, "giu")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function formatDocumentKeywordCountAnswer(input: {
  keyword: string
  count: number
  sourceTitle: string
}): string {
  const times = input.count === 1 ? "time" : "times"
  return `The keyword "${input.keyword}" appears ${input.count} ${times} in ${input.sourceTitle} across the parsed document chunks. [Source 1: ${DOCUMENT_COUNT_DESCRIPTION}]`
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
