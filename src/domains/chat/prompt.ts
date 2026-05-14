import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { generateText } from "ai"
import { Effect } from "effect"

import { CHAT_MODEL } from "@/lib/ai"
import type { Source } from "@/infrastructure/db/schema"
import type { ChatCitationView } from "@/domains/chat/types"
import type { ChatHistoryMessage } from "./contracts"
import { normalizeRetrievalQuery } from "./retrieval"

const RECENT_CONTEXT_MESSAGE_LIMIT = 8
const CONTEXT_CONTENT_CHAR_LIMIT = 900
const SOURCE_CONTEXT_LIMIT = 12

type GenerateContextualRetrievalQueryInput = {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
}

type GenerateGroundedAnswerInput = {
  question: string
  retrievalQuery: string
  messages: readonly ChatHistoryMessage[]
  results: readonly RetrievalResult[]
}

type BuildGroundedPromptInput = {
  question: string
  retrievalQuery?: string
  messages?: readonly ChatHistoryMessage[]
  results: readonly RetrievalResult[]
}

export const generateContextualRetrievalQueryEffect = (
  input: GenerateContextualRetrievalQueryInput,
): Effect.Effect<string, unknown> =>
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
export async function generateContextualRetrievalQuery(
  input: GenerateContextualRetrievalQueryInput,
): Promise<string> {
  return Effect.runPromise(generateContextualRetrievalQueryEffect(input))
}

export const generateGroundedAnswerEffect = (
  input: GenerateGroundedAnswerInput,
): Effect.Effect<string, unknown> =>
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
export async function generateGroundedAnswer(
  input: GenerateGroundedAnswerInput,
): Promise<string> {
  return Effect.runPromise(generateGroundedAnswerEffect(input))
}

export function buildRetrievalQueryPrompt(
  input: GenerateContextualRetrievalQueryInput,
): string {
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

export function buildGroundedPrompt(input: BuildGroundedPromptInput): string {
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
    "You answer user questions.",
    "Use the retrieved source excerpts as helpful context, not as the only allowed information.",
    "Cite a source when it supports a claim.",
    "If the sources are related but incomplete, answer what you can and briefly say what is not covered.",
    "Do not invent document-specific facts that are not in the sources.",
    "Use the recent conversation only to resolve references like \"this document\"; do not use it as factual evidence.",
    "Answer in a natural, friendly, and direct tone.",
    "Start with the answer first. Avoid meta phrases like \"Based on the sources\" or \"Based on the source excerpts\" unless the user asks how you know.",
    "Use plain language.",
    "Keep answers concise by default: 1-3 short paragraphs unless the user asks for detail.",
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
