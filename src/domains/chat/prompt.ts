import {
  generateText,
  pruneMessages,
  stepCountIs,
  ToolLoopAgent,
  tool,
  type ModelMessage,
  type PrepareStepFunction,
} from "ai"
import { Effect } from "effect"
import type { RetrievalQueryResponse, RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { z } from "zod"

import { CHAT_MODEL } from "@/lib/ai"
import type { Source } from "@/infrastructure/db/schema"
import type { ChatCitationView } from "@/domains/chat/types"
import type {
  AgenticRetrievalQuery,
  ChatHistoryMessage,
  SearchSources,
} from "./contracts"
import { normalizeRetrievalQuery } from "./retrieval"

const RECENT_CONTEXT_MESSAGE_LIMIT = 8
const CONTEXT_CONTENT_CHAR_LIMIT = 900
const COMPACTED_HISTORY_MESSAGE_LIMIT = 12
const COMPACTED_HISTORY_CONTENT_CHAR_LIMIT = 500
const STORED_HISTORY_MESSAGE_LIMIT = 20
const STORED_HISTORY_CHAR_BUDGET = 12_000
const AGENT_STEP_MESSAGE_LIMIT = 20
const AGENT_STEP_RECENT_MESSAGE_LIMIT = 12
const AGENT_STEP_CONTEXT_CHAR_BUDGET = 16_000
const SOURCE_CONTEXT_LIMIT = 12
const AGENTIC_SEARCH_STEP_LIMIT = 5
const TOOL_EVIDENCE_CHAR_LIMIT = 6_000
const TOOL_RESULT_CONTENT_CHAR_LIMIT = 700
const TOOL_RESULT_LIMIT = 8
const TOOL_REFERENCED_CHUNK_LIMIT = 12
const RAW_URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/g
const REDACTED_MEDIA_URL = "[media asset URL hidden]"

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
  evidenceText: string
  mediaAssetContext?: string
}

type BuildGroundedPromptInput = {
  question: string
  retrievalQuery?: string
  messages?: readonly ChatHistoryMessage[]
  evidenceText: string
  mediaAssetContext?: string
}

type GenerateAgenticGroundedAnswerInput = {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  searchSources: SearchSources
}

type AgenticChatTools = ReturnType<typeof buildAgenticChatTools>

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

/** Async wrapper for the legacy single-query retrieval flow. */
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

/** Async wrapper for the legacy single-response answer flow. */
export async function generateGroundedAnswer(
  input: GenerateGroundedAnswerInput,
): Promise<string> {
  return Effect.runPromise(generateGroundedAnswerEffect(input))
}

export const generateAgenticGroundedAnswerEffect = (
  input: GenerateAgenticGroundedAnswerInput,
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

    const agent = buildAgenticChatAgent(input)
    const response = yield* Effect.tryPromise(() =>
      agent.generate({
        messages: buildAgenticChatMessages(input),
      }),
    )
    return response.text.trim()
  })

export async function generateAgenticGroundedAnswer(
  input: GenerateAgenticGroundedAnswerInput,
): Promise<string> {
  return Effect.runPromise(generateAgenticGroundedAnswerEffect(input))
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
  const mediaAssetContext = input.mediaAssetContext?.trim()

  const promptLines = [
    "You answer user questions.",
    "Use the retrieved evidence as your primary context.",
    "Cite document sections (e.g. [文档名 / 章节名]) when they support a claim.",
    "When retrieved image or table asset references are relevant to the user's request, cite the matching source label; the UI renders media from citation metadata.",
    "Do not write raw media asset URLs in the answer. They are internal metadata only.",
    "Do not invent asset URLs; use only the retrieved media asset references listed below.",
    "If the sources are related but incomplete, answer what you can and briefly say what is not covered.",
    "Do not invent document-specific facts that are not in the sources.",
    "Use the recent conversation only to resolve references like \"this document\"; do not use it as factual evidence.",
    "Answer in a natural, friendly, and direct tone.",
    "Start with the answer first. Avoid meta phrases like \"Based on the sources\" or \"Based on the source excerpts\" unless the user asks how you know.",
    "Use plain language.",
    "Keep answers concise by default: 1-3 short paragraphs unless the user asks for detail.",
    "CITATION FORMAT: Cite evidence by document and section path, e.g. [文档名 / 章节名].",
    "",
    `Question: ${input.question}`,
    `Retrieval query used: ${retrievalQuery}`,
    "",
    "Recent conversation:",
    conversationContext,
    "",
    "Retrieved evidence:",
    input.evidenceText,
  ]

  if (mediaAssetContext) {
    promptLines.push(
      "",
      "Retrieved media asset references (internal; do not quote raw URLs):",
      mediaAssetContext,
    )
  }

  return promptLines.join("\n")
}

export function buildAgenticChatSystemPrompt(
  input: Pick<
    GenerateAgenticGroundedAnswerInput,
    "messages" | "sources" | "excludedSourceIds"
  >,
): string {
  const sourceContext = formatSourceContext(input.sources, input.excludedSourceIds)

  return [
    "You are a Notebook research agent that answers user questions from their uploaded sources.",
    "You have one tool: searchSources. It runs Knowhere retrieval and returns a RetrievalQueryResponse summary.",
    "Treat each tool result like external context from a remote source index: inspect it, reason over it, then decide whether to retrieve again.",
    "",
    "Agent loop rules:",
    "1. Always call searchSources before writing a final answer.",
    "2. Read the tool output fields: evidenceText, answerText, results, referencedChunks, stopReason, failureReason, and decisionTrace.",
    "3. Use one response to guide the next query: carry forward discovered people, organizations, document names, section paths, file paths, chunk types, and failure reasons.",
    "4. If evidenceText/results/referencedChunks directly support the answer, stop searching and answer.",
    "5. If failureReason is present, result counts are zero, or evidence does not cover the user's requested entity/topic/media, call searchSources again with a more specific or broader query.",
    "6. For image requests use dataType=3 or dataType=5. If an initial text result identifies a relevant person or section but not an image asset, query again with that person/section plus the requested image concept, e.g. identity card / 身份证 / 公民身份证明.",
    "7. For table requests use dataType=4 or dataType=6.",
    "8. Do not paste raw prior messages into searchSources.query. The query must be concise and contain only distilled search terms such as document title, person, topic, date, section path, or asset kind.",
    "9. Stop after enough evidence or when further searches are unlikely to help; then clearly say what was not found and what retrieval context was missing.",
    "",
    "Answering rules:",
    "Use retrieved evidence as the factual source of truth.",
    "Do not invent document-specific facts.",
    "Conversation context is supplied as managed model messages. Use it only to resolve references like \"this document\" or \"those images\".",
    "Cite document sections in the answer, e.g. [文档名 / 章节名].",
    "When retrieved image or table assets are relevant, cite the matching source label; the UI renders media from citation metadata.",
    "Do not write raw media asset URLs in the answer. They are internal metadata only.",
    "Start with the answer first. Keep answers concise unless the user asks for detail.",
    "",
    "Searchable sources:",
    sourceContext,
  ].join("\n")
}

function buildAgenticChatAgent(
  input: GenerateAgenticGroundedAnswerInput,
): ToolLoopAgent<never, AgenticChatTools> {
  return new ToolLoopAgent({
    model: CHAT_MODEL,
    instructions: buildAgenticChatSystemPrompt(input),
    tools: buildAgenticChatTools(input),
    stopWhen: stepCountIs(AGENTIC_SEARCH_STEP_LIMIT),
    prepareStep: buildAgenticPrepareStep(),
  })
}

function buildAgenticChatTools(
  input: Pick<GenerateAgenticGroundedAnswerInput, "searchSources">,
) {
  return {
    searchSources: tool({
      description:
        "Search the user's Notebook sources through Knowhere retrieval. " +
        "Treat each response as external context from a remote source index. " +
        "Use it before answering, and call it again with refined text, media, " +
        "or section-path queries when the RetrievalQueryResponse says evidence is missing or weak.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            "A concise, self-contained retrieval query. Do not paste raw chat history or previous messages. Use only distilled terms such as document title, person, topic, date, section path, or asset kind when needed.",
          ),
        topK: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Number of chunks to return. Defaults to 8."),
        dataType: z
          .union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5),
            z.literal(6),
          ])
          .optional()
          .describe(
            "Optional chunk type filter: 1=all, 2=text, 3=image, 4=table, 5=text+image, 6=text+table.",
          ),
        signalPaths: z
          .array(z.string().min(1))
          .max(8)
          .optional()
          .describe(
            "Optional section/path keywords when a previous result points to a useful section.",
          ),
        filterMode: z
          .enum(["keep", "delete"])
          .optional()
          .describe(
            "How to apply signalPaths. Use keep to focus on matching paths, delete to exclude them.",
          ),
        threshold: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Optional minimum retrieval score threshold."),
      }),
      execute: async (queryInput: AgenticRetrievalQuery) =>
        buildRetrievalToolOutput(await input.searchSources(queryInput)),
    }),
  } as const
}

function buildAgenticPrepareStep(): PrepareStepFunction<AgenticChatTools> {
  return ({ stepNumber, messages }) => {
    const managedMessages = buildAgentStepMessages(messages)
    if (stepNumber === 0) {
      return {
        messages: managedMessages,
        toolChoice: {
          type: "tool" as const,
          toolName: "searchSources" as const,
        },
        activeTools: ["searchSources" as const],
      }
    }

    return { messages: managedMessages }
  }
}

function buildAgenticChatMessages(
  input: Pick<GenerateAgenticGroundedAnswerInput, "messages" | "question">,
): ModelMessage[] {
  return [
    ...buildManagedStoredHistoryMessages(input.messages),
    { role: "user", content: input.question },
  ]
}

function buildManagedStoredHistoryMessages(
  messages: readonly ChatHistoryMessage[],
): ModelMessage[] {
  const exactMessages = messages.map(toModelMessage)
  if (
    exactMessages.length <= STORED_HISTORY_MESSAGE_LIMIT &&
    getModelMessagesCharLength(exactMessages) <= STORED_HISTORY_CHAR_BUDGET
  ) {
    return exactMessages
  }

  const recentMessages = messages.slice(-RECENT_CONTEXT_MESSAGE_LIMIT)
  const olderMessages = messages.slice(0, -RECENT_CONTEXT_MESSAGE_LIMIT)
  const compactedHistoryContext = formatCompactedHistoryContext(olderMessages)

  return [
    ...(compactedHistoryContext
      ? [
          {
            role: "system" as const,
            content: compactedHistoryContext,
          },
        ]
      : []),
    ...recentMessages.map(toModelMessage),
  ]
}

function buildAgentStepMessages(messages: ModelMessage[]): ModelMessage[] {
  const prunedMessages = pruneMessages({
    messages: [...messages],
    reasoning: "before-last-message",
    toolCalls: [{ type: "before-last-4-messages", tools: ["searchSources"] }],
    emptyMessages: "remove",
  })

  if (
    prunedMessages.length <= AGENT_STEP_MESSAGE_LIMIT &&
    getModelMessagesCharLength(prunedMessages) <= AGENT_STEP_CONTEXT_CHAR_BUDGET
  ) {
    return prunedMessages
  }

  const systemMessages = prunedMessages.filter(
    (message): boolean => message.role === "system",
  )
  const nonSystemMessages = prunedMessages.filter(
    (message): boolean => message.role !== "system",
  )

  return [
    ...systemMessages,
    ...nonSystemMessages.slice(-AGENT_STEP_RECENT_MESSAGE_LIMIT),
  ]
}

function toModelMessage(message: ChatHistoryMessage): ModelMessage {
  return {
    role: message.role,
    content: message.content,
  }
}

function formatCompactedHistoryContext(
  messages: readonly ChatHistoryMessage[],
): string {
  if (messages.length === 0) return ""

  const selectedMessages = messages.slice(-COMPACTED_HISTORY_MESSAGE_LIMIT)
  const omittedMessageCount = messages.length - selectedMessages.length
  const lines = selectedMessages.map((message): string => {
    const content = truncateContextTextToLimit(
      message.content,
      COMPACTED_HISTORY_CONTENT_CHAR_LIMIT,
    )
    const citationContext = formatCitationContext(message.citations ?? [])
    return citationContext
      ? `- ${message.role}: ${content}\n  citations: ${citationContext}`
      : `- ${message.role}: ${content}`
  })

  return [
    "Compacted earlier conversation for context. This is not a retrieval query and must not be pasted into searchSources.query.",
    omittedMessageCount > 0
      ? `${omittedMessageCount} earlier messages were omitted before this compacted context.`
      : "",
    ...lines,
  ]
    .filter((line): boolean => line.length > 0)
    .join("\n")
}

function getModelMessagesCharLength(messages: readonly ModelMessage[]): number {
  return messages.reduce(
    (totalLength, message): number =>
      totalLength + getUnknownTextLength(message.content),
    0,
  )
}

function getUnknownTextLength(value: unknown): number {
  if (typeof value === "string") return value.length
  if (value === null || value === undefined) return 0
  return JSON.stringify(value).length
}

function buildRetrievalToolOutput(response: RetrievalQueryResponse): object {
  return {
    namespace: response.namespace,
    query: response.query,
    routerUsed: response.routerUsed,
    stopReason: response.stopReason ?? null,
    failureReason: response.failureReason ?? null,
    answerText: response.answerText
      ? redactRawUrls(response.answerText)
      : response.answerText,
    resultCount: response.results.length,
    referencedChunkCount: response.referencedChunks.length,
    hasEvidenceText: Boolean(response.evidenceText?.trim()),
    evidenceText: truncateSafeContextTextToLimit(
      response.evidenceText ?? "",
      TOOL_EVIDENCE_CHAR_LIMIT,
    ),
    results: response.results.slice(0, TOOL_RESULT_LIMIT).map(formatToolResult),
    referencedChunks: response.referencedChunks
      .slice(0, TOOL_REFERENCED_CHUNK_LIMIT)
      .map((chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        chunkType: chunk.chunkType,
        sectionPath: chunk.sectionPath,
        filePath: chunk.filePath ? redactRawUrls(chunk.filePath) : null,
        hasAssetUrl: Boolean(chunk.assetUrl),
      })),
    decisionTrace:
      response.decisionTrace
        ?.slice(-6)
        .map((trace) => redactRawUrlsFromUnknown(trace)) ?? [],
    agentGuidance: getRetrievalResponseGuidance(response),
  }
}

function formatToolResult(result: RetrievalResult): object {
  return {
    chunkType: result.chunkType,
    score: result.score,
    hasAssetUrl: Boolean(result.assetUrl),
    source: {
      documentId: result.source.documentId ?? null,
      sourceFileName: result.source.sourceFileName
        ? redactRawUrls(result.source.sourceFileName)
        : null,
      sectionPath: result.source.sectionPath
        ? redactRawUrls(result.source.sectionPath)
        : null,
    },
    content: truncateSafeContextTextToLimit(
      result.content,
      TOOL_RESULT_CONTENT_CHAR_LIMIT,
    ),
  }
}

function getRetrievalResponseGuidance(
  response: RetrievalQueryResponse,
): string {
  const hasEvidence = Boolean(response.evidenceText?.trim())
  const hasResults =
    response.results.length > 0 || response.referencedChunks.length > 0

  if (response.failureReason) {
    return (
      "Retrieval reported a semantic failure. If the user question is still answerable, " +
      "try one refined query; otherwise say the sources do not contain enough support."
    )
  }
  if (!hasEvidence && !hasResults) {
    return (
      "No useful evidence was returned. Try a broader query, a different wording, " +
      "or a media/table dataType filter if the user asked for images or tables."
    )
  }
  if (response.stopReason && response.stopReason !== "answer_done") {
    return (
      `Retrieval stopped with stopReason=${response.stopReason}. Inspect evidence; ` +
      "if it does not directly answer the user, query again with a better target."
    )
  }
  return (
    "Use this evidence if it directly answers the user. Query again only if an " +
    "important requested detail, source, image, table, person, date, or section is missing."
  )
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

function truncateContextTextToLimit(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

function truncateSafeContextTextToLimit(value: string, limit: number): string {
  return truncateContextTextToLimit(redactRawUrls(value), limit)
}

function redactRawUrls(value: string): string {
  return value.replace(RAW_URL_PATTERN, REDACTED_MEDIA_URL)
}

function redactRawUrlsFromUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactRawUrls(value)
  if (Array.isArray(value)) return value.map(redactRawUrlsFromUnknown)
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      redactRawUrlsFromUnknown(nestedValue),
    ]),
  )
}
