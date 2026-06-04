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
import type {
  RetrievalQueryResponse,
  RetrievalReferencedChunk,
} from "@ontos-ai/knowhere-sdk"
import { z } from "zod"

import { CHAT_MODEL } from "@/lib/ai"
import { logger } from "@/lib/logger"
import type { Source } from "@/infrastructure/db/schema"
import type { ChatCitationView } from "@/domains/chat/types"
import type {
  AgenticRetrievalQuery,
  AgenticRetrievalResponse,
  ChatHistoryMessage,
  ReadRetrievedChunk,
  ReadRetrievedChunkInput,
  ReadRetrievedChunkResult,
  RetrievedChunkReference,
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
const TOOL_CHUNK_READ_LIMIT_DEFAULT = 2_000
const TOOL_CHUNK_READ_LIMIT_MAX = 4_000
const AGENT_LOOP_TOOL_INPUT_LOG_LIMIT = 1_200
const AGENT_LOOP_TOOL_OUTPUT_LOG_LIMIT = 2_400
const AGENT_LOOP_TOOL_LOG_ENTRY_LIMIT = 4
const KNOWHERE_TOOL_TEXT_LOG_LIMIT = 200
const KNOWHERE_TOOL_CHUNK_LOG_LIMIT = 100
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
  readRetrievedChunk: ReadRetrievedChunk
}

type AgenticChatTools = ReturnType<typeof buildAgenticChatTools>

type AgentLoopLogPreview = {
  readonly charLength: number
  readonly truncated: boolean
  readonly preview: string
}

type AgentLoopToolCallLog = {
  readonly toolName: string
  readonly toolCallId: string | null
  readonly input: AgentLoopLogPreview
}

type AgentLoopToolOutputLog =
  | AgentLoopLogPreview
  | AgentLoopSearchSourcesOutputLog
  | AgentLoopReadChunkOutputLog

type AgentLoopToolResultLog = {
  readonly toolName: string
  readonly toolCallId: string | null
  readonly output: AgentLoopToolOutputLog
}

type AgentLoopStepLog = {
  readonly stepNumber: number
  readonly finishReason: string | null
  readonly responseText: string
  readonly responseTextCharLength: number
  readonly toolCallCount: number
  readonly toolCalls: readonly AgentLoopToolCallLog[]
  readonly toolCallsOmitted: number
  readonly toolResultCount: number
  readonly toolResults: readonly AgentLoopToolResultLog[]
  readonly toolResultsOmitted: number
}

type AgentLoopSearchSourcesOutputLog = {
  readonly kind: "searchSources"
  readonly query: string | null
  readonly routerUsed: string | null
  readonly stopReason: string | null
  readonly failureReason: string | null
  readonly resultCount: number | null
  readonly referencedChunkCount: number | null
  readonly readableChunkCount: number | null
  readonly answerText: string | null
  readonly evidenceText: string
  readonly results: readonly AgentLoopChunkContentLog[]
  readonly referencedChunks: readonly AgentLoopChunkSummaryLog[]
  readonly chunkReferences: readonly AgentLoopChunkSummaryLog[]
}

type AgentLoopReadChunkOutputLog = {
  readonly kind: "readRetrievedChunk"
  readonly found: boolean | null
  readonly chunkType: string | null
  readonly offset: number | null
  readonly limit: number | null
  readonly contentLength: number | null
  readonly contentSlice: string
  readonly hasMoreContent: boolean | null
  readonly nextOffset: number | null
}

type AgentLoopChunkContentLog = {
  readonly chunkType: string | null
  readonly content: string
}

type AgentLoopChunkSummaryLog = {
  readonly chunkType: string | null
  readonly summary: string
}

type LlmModelMessageLog = {
  readonly role: string
  readonly contentCharLength: number
  readonly content: unknown
}

type GenerateLoggedTextInput = {
  readonly operation: string
  readonly prompt: string
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

    const prompt = buildRetrievalQueryPrompt({
      question,
      messages: input.messages,
      sources: input.sources,
      excludedSourceIds: input.excludedSourceIds,
    })
    const response = yield* Effect.tryPromise(() =>
      generateLoggedText({
        operation: "generateContextualRetrievalQuery",
        prompt,
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
      generateLoggedText({
        operation: "generateGroundedAnswer",
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
    const messages = buildAgenticChatMessages(input)
    logger.info("chat-agent: llm request", {
      operation: "generateAgenticGroundedAnswer.initial",
      model: CHAT_MODEL,
      promptType: "messages",
      messageCount: messages.length,
      messages: formatModelMessagesForLlmLog(messages),
    })
    const response = yield* Effect.tryPromise(async () => {
      const generationResponse = await agent.generate({ messages })
      logger.info("chat-agent: llm response", {
        operation: "generateAgenticGroundedAnswer.final",
        model: CHAT_MODEL,
        responseTextCharLength: generationResponse.text.length,
        responseText: redactRawUrls(generationResponse.text),
      })
      return generationResponse
    })
    return response.text.trim()
  })

export async function generateAgenticGroundedAnswer(
  input: GenerateAgenticGroundedAnswerInput,
): Promise<string> {
  return Effect.runPromise(generateAgenticGroundedAnswerEffect(input))
}

async function generateLoggedText(
  input: GenerateLoggedTextInput,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  logger.info("chat-agent: llm request", {
    operation: input.operation,
    model: CHAT_MODEL,
    promptType: "text",
    promptCharLength: input.prompt.length,
    prompt: redactRawUrls(input.prompt),
  })
  const response = await generateText({
    model: CHAT_MODEL,
    prompt: input.prompt,
  })
  logger.info("chat-agent: llm response", {
    operation: input.operation,
    model: CHAT_MODEL,
    responseTextCharLength: response.text.length,
    responseText: redactRawUrls(response.text),
  })
  return response
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
    "You have two tools: searchSources and readRetrievedChunk.",
    "searchSources runs Knowhere retrieval and returns a RetrievalQueryResponse summary with compact previews and request-local chunk ids.",
    "readRetrievedChunk reads more content from a chunk id returned by searchSources in this same answer run.",
    "Treat each tool result like external context from a remote source index: inspect it, reason over it, then decide whether to retrieve again or read more from a returned chunk.",
    "Use searchSources like L0/L1 retrieval: compact previews are for quick relevance, navigation, and rerank-style selection. Use readRetrievedChunk like L2 detail: full content slices are loaded only after a returned chunk looks relevant.",
    "",
    "Agent loop rules:",
    "1. Always call searchSources before writing a final answer.",
    "2. Before each searchSources call, choose a typed retrieval plan: intent, purpose, and priority. This is Notebook-side intent analysis for the agent loop.",
    "3. Use intent=overview for broad discovery, entity for people/organizations, section for located headings/paths, image for visual assets, table for tabular evidence, detail for precise facts, and citation for source verification.",
    "4. Read the tool output fields: retrievalPlan, evidenceText, answerText, results, referencedChunks, chunkReferences, stopReason, failureReason, and decisionTrace.",
    "5. Use one response to guide the next query: carry forward discovered people, organizations, document names, section paths, file paths, chunk types, and failure reasons.",
    "6. If evidenceText/results/referencedChunks directly support the answer, stop searching and answer.",
    "7. If failureReason is present, result counts are zero, or evidence does not cover the user's requested entity/topic/media, call searchSources again with a more specific or broader query.",
    "8. For image requests use intent=image and dataType=3 or dataType=5. If an initial text result identifies a relevant person or section but not an image asset, query again with that person/section plus the requested image concept, e.g. identity card / 身份证 / 公民身份证明.",
    "9. For table requests use intent=table and dataType=4 or dataType=6.",
    "10. Do not paste raw prior messages into searchSources.query. The query must be concise and contain only distilled search terms such as document title, person, topic, date, section path, or asset kind.",
    "11. If a returned chunk preview looks relevant but you want more data before answering, call readRetrievedChunk with that chunk id plus offset/limit. If hasMoreContent is true and the next slice is still needed, call readRetrievedChunk again with nextOffset.",
    "12. Use readRetrievedChunk selectively; do not read every chunk when the previews already answer the question.",
    "13. Stop after enough evidence or when further searches are unlikely to help; then clearly say what was not found and what retrieval context was missing.",
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
  const instructions = buildAgenticChatSystemPrompt(input)
  return new ToolLoopAgent({
    model: CHAT_MODEL,
    instructions,
    tools: buildAgenticChatTools(input),
    stopWhen: stepCountIs(AGENTIC_SEARCH_STEP_LIMIT),
    prepareStep: buildAgenticPrepareStep(instructions),
    onStepFinish: (event) => {
      logger.info("chat-agent: llm response", {
        operation: "generateAgenticGroundedAnswer.step",
        model: CHAT_MODEL,
        stepNumber: event.stepNumber,
        finishReason: event.finishReason,
        responseTextCharLength: event.text.length,
        responseText: redactRawUrls(event.text),
        toolCallCount: event.toolCalls.length,
        toolCalls: formatAgentLoopToolCalls(event.toolCalls),
        toolCallsOmitted: getOmittedAgentLoopEntryCount(event.toolCalls),
        toolResultCount: event.toolResults.length,
        toolResults: formatAgentLoopToolResults(event.toolResults),
        toolResultsOmitted: getOmittedAgentLoopEntryCount(event.toolResults),
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        totalTokens: event.usage.totalTokens,
      })
    },
    onFinish: (event) => {
      logger.info("chat-agent: loop finished", {
        stepCount: event.steps.length,
        finishReason: event.finishReason,
        responseTextCharLength: event.text.length,
        responseText: redactRawUrls(event.text),
        steps: event.steps.map(formatAgentLoopStep),
        toolNames: Array.from(
          new Set(
            event.steps.flatMap((step) =>
              step.toolCalls.map((toolCall) => toolCall.toolName),
            ),
          ),
        ),
        inputTokens: event.totalUsage.inputTokens,
        outputTokens: event.totalUsage.outputTokens,
        totalTokens: event.totalUsage.totalTokens,
      })
    },
  })
}

function buildAgenticChatTools(
  input: Pick<
    GenerateAgenticGroundedAnswerInput,
    "searchSources" | "readRetrievedChunk"
  >,
) {
  return {
    searchSources: tool({
      description:
        "Search the user's Notebook sources through Knowhere retrieval. " +
        "Treat each response as external context from a remote source index. " +
        "Use it before answering, include a typed retrieval plan, and call it " +
        "again with refined text, media, or section-path queries when the " +
        "RetrievalQueryResponse says evidence is missing or weak.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            "A concise, self-contained retrieval query. Do not paste raw chat history or previous messages. Use only distilled terms such as document title, person, topic, date, section path, or asset kind when needed.",
          ),
        intent: z
          .enum([
            "overview",
            "entity",
            "section",
            "image",
            "table",
            "detail",
            "citation",
          ])
          .optional()
          .describe(
            "Typed retrieval intent for the agent loop: overview, entity, section, image, table, detail, or citation. Use image/table for visual or tabular requests.",
          ),
        purpose: z
          .string()
          .min(1)
          .max(240)
          .optional()
          .describe(
            "Short reason this query is needed, such as finding an entity, locating an image asset, or verifying a citation.",
          ),
        priority: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe(
            "Planner priority from 1-5. Use 5 for required evidence and lower values for exploratory follow-up.",
          ),
        topK: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Number of chunks to return. Defaults to 8."),
        dataType: z
          .number()
          .int()
          .min(1)
          .max(6)
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
    readRetrievedChunk: tool({
      description:
        "Read an offset/limit content slice from a request-local chunk id " +
        "returned by searchSources. Use this when a returned chunk preview is relevant " +
        "and you want more data before answering.",
      inputSchema: z.object({
        id: z
          .string()
          .min(1)
          .describe(
            "The request-local id or chunkId from searchSources.results, searchSources.referencedChunks, or searchSources.chunkReferences.",
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Character offset to start reading from. Defaults to 0."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(TOOL_CHUNK_READ_LIMIT_MAX)
          .optional()
          .describe(
            `Maximum characters to return. Defaults to ${TOOL_CHUNK_READ_LIMIT_DEFAULT}; max ${TOOL_CHUNK_READ_LIMIT_MAX}.`,
          ),
      }),
      execute: async (readInput: ReadRetrievedChunkInput) =>
        buildRetrievedChunkToolOutput(
          await input.readRetrievedChunk(readInput),
        ),
    }),
  } as const
}

function buildAgenticPrepareStep(
  instructions: string,
): PrepareStepFunction<AgenticChatTools> {
  return ({ stepNumber, messages }) => {
    const managedMessages = buildAgentStepMessages(messages)
    if (stepNumber === 0) {
      const stepInput = {
        messages: managedMessages,
        toolChoice: {
          type: "tool" as const,
          toolName: "searchSources" as const,
        },
        activeTools: ["searchSources" as const],
      }
      logAgentStepLlmRequest({
        stepNumber,
        instructions,
        messages: managedMessages,
        toolChoice: stepInput.toolChoice,
        activeTools: stepInput.activeTools,
      })
      return stepInput
    }

    logAgentStepLlmRequest({
      stepNumber,
      instructions,
      messages: managedMessages,
      toolChoice: null,
      activeTools: null,
    })
    return { messages: managedMessages }
  }
}

function formatAgentLoopStep(step: unknown, index: number): AgentLoopStepLog {
  const record = getRecordFromUnknown(step)
  const toolCalls = getRecordArray(record, "toolCalls")
  const toolResults = getRecordArray(record, "toolResults")
  const responseText = getRecordString(record, "text") ?? ""
  return {
    stepNumber:
      getRecordNumber(record, "stepNumber") ??
      getRecordNumber(record, "stepIndex") ??
      index + 1,
    finishReason: getRecordString(record, "finishReason"),
    responseText: redactRawUrls(responseText),
    responseTextCharLength: responseText.length,
    toolCallCount: toolCalls.length,
    toolCalls: formatAgentLoopToolCalls(toolCalls),
    toolCallsOmitted: getOmittedAgentLoopEntryCount(toolCalls),
    toolResultCount: toolResults.length,
    toolResults: formatAgentLoopToolResults(toolResults),
    toolResultsOmitted: getOmittedAgentLoopEntryCount(toolResults),
  }
}

function formatAgentLoopToolCalls(
  toolCalls: readonly unknown[],
): readonly AgentLoopToolCallLog[] {
  return toolCalls
    .slice(0, AGENT_LOOP_TOOL_LOG_ENTRY_LIMIT)
    .map(formatAgentLoopToolCall)
}

function formatAgentLoopToolCall(toolCall: unknown): AgentLoopToolCallLog {
  const record = getRecordFromUnknown(toolCall)
  return {
    toolName: getRecordString(record, "toolName") ?? "unknown",
    toolCallId: getRecordString(record, "toolCallId"),
    input: buildAgentLoopPreview(
      getFirstRecordValue(record, ["input", "args", "arguments"]),
      AGENT_LOOP_TOOL_INPUT_LOG_LIMIT,
    ),
  }
}

function formatAgentLoopToolResults(
  toolResults: readonly unknown[],
): readonly AgentLoopToolResultLog[] {
  return toolResults
    .slice(0, AGENT_LOOP_TOOL_LOG_ENTRY_LIMIT)
    .map(formatAgentLoopToolResult)
}

function formatAgentLoopToolResult(toolResult: unknown): AgentLoopToolResultLog {
  const record = getRecordFromUnknown(toolResult)
  const toolName = getRecordString(record, "toolName") ?? "unknown"
  return {
    toolName,
    toolCallId: getRecordString(record, "toolCallId"),
    output: formatAgentLoopToolOutput(
      toolName,
      getFirstRecordValue(record, ["output", "result", "content"]),
    ),
  }
}

function formatAgentLoopToolOutput(
  toolName: string,
  output: unknown,
): AgentLoopToolOutputLog {
  if (toolName === "searchSources") {
    return formatSearchSourcesToolOutput(output)
  }
  if (toolName === "readRetrievedChunk") {
    return formatReadRetrievedChunkToolOutput(output)
  }
  return buildAgentLoopPreview(output, AGENT_LOOP_TOOL_OUTPUT_LOG_LIMIT)
}

function formatSearchSourcesToolOutput(
  output: unknown,
): AgentLoopSearchSourcesOutputLog {
  const record = getRecordFromUnknown(output)
  return {
    kind: "searchSources",
    query: getRecordString(record, "query"),
    routerUsed: getRecordString(record, "routerUsed"),
    stopReason: getRecordString(record, "stopReason"),
    failureReason: getRecordString(record, "failureReason"),
    resultCount: getRecordNumber(record, "resultCount"),
    referencedChunkCount: getRecordNumber(record, "referencedChunkCount"),
    readableChunkCount: getRecordNumber(record, "readableChunkCount"),
    answerText: truncateAgentLoopLogTextOrNull(
      getRecordString(record, "answerText"),
      KNOWHERE_TOOL_TEXT_LOG_LIMIT,
    ),
    evidenceText: truncateAgentLoopLogText(
      getRecordString(record, "evidenceText") ?? "",
      KNOWHERE_TOOL_TEXT_LOG_LIMIT,
    ),
    results: getRecordArray(record, "results").map(formatToolOutputChunkContent),
    referencedChunks: getRecordArray(record, "referencedChunks").map(
      formatToolOutputChunkSummary,
    ),
    chunkReferences: getRecordArray(record, "chunkReferences").map(
      formatToolOutputChunkSummary,
    ),
  }
}

function formatReadRetrievedChunkToolOutput(
  output: unknown,
): AgentLoopReadChunkOutputLog {
  const record = getRecordFromUnknown(output)
  return {
    kind: "readRetrievedChunk",
    found: getRecordBoolean(record, "found"),
    chunkType: getRecordString(record, "chunkType"),
    offset: getRecordNumber(record, "offset"),
    limit: getRecordNumber(record, "limit"),
    contentLength: getRecordNumber(record, "contentLength"),
    contentSlice: truncateAgentLoopLogText(
      getRecordString(record, "contentSlice") ?? "",
      KNOWHERE_TOOL_CHUNK_LOG_LIMIT,
    ),
    hasMoreContent: getRecordBoolean(record, "hasMoreContent"),
    nextOffset: getRecordNumber(record, "nextOffset"),
  }
}

function formatToolOutputChunkContent(
  value: unknown,
): AgentLoopChunkContentLog {
  const record = getRecordFromUnknown(value)
  return {
    chunkType: getRecordString(record, "chunkType"),
    content: truncateAgentLoopLogText(
      getFirstRecordString(record, ["content", "contentPreview"]),
      KNOWHERE_TOOL_CHUNK_LOG_LIMIT,
    ),
  }
}

function formatToolOutputChunkSummary(
  value: unknown,
): AgentLoopChunkSummaryLog {
  const record = getRecordFromUnknown(value)
  const source = getRecordFromUnknown(record?.source)
  return {
    chunkType: getRecordString(record, "chunkType"),
    summary: truncateAgentLoopLogText(
      getFirstRecordString(record, [
        "summary",
        "sectionPath",
        "filePath",
        "content",
        "contentPreview",
      ]) || getRecordString(source, "sectionPath") || "",
      KNOWHERE_TOOL_CHUNK_LOG_LIMIT,
    ),
  }
}

function getOmittedAgentLoopEntryCount(entries: readonly unknown[]): number {
  return Math.max(0, entries.length - AGENT_LOOP_TOOL_LOG_ENTRY_LIMIT)
}

function logAgentStepLlmRequest(input: {
  readonly stepNumber: number
  readonly instructions: string
  readonly messages: readonly ModelMessage[]
  readonly toolChoice: unknown
  readonly activeTools: readonly string[] | null
}): void {
  logger.info("chat-agent: llm request", {
    operation: "generateAgenticGroundedAnswer.step",
    model: CHAT_MODEL,
    promptType: "messages",
    stepNumber: input.stepNumber,
    instructionsCharLength: input.instructions.length,
    instructions: redactRawUrls(input.instructions),
    messageCount: input.messages.length,
    messages: formatModelMessagesForLlmLog(input.messages),
    toolChoice: input.toolChoice,
    activeTools: input.activeTools,
  })
}

function formatModelMessagesForLlmLog(
  messages: readonly ModelMessage[],
): readonly LlmModelMessageLog[] {
  return messages.map(formatModelMessageForLlmLog)
}

function formatModelMessageForLlmLog(message: ModelMessage): LlmModelMessageLog {
  return {
    role: message.role,
    contentCharLength: getUnknownTextLength(message.content),
    content: redactRawUrlsFromUnknown(message.content),
  }
}

function buildAgentLoopPreview(
  value: unknown,
  limit: number,
): AgentLoopLogPreview {
  const normalized = redactRawUrls(stringifyAgentLoopLogValue(value))
    .replace(/\s+/g, " ")
    .trim()
  const truncated = normalized.length > limit
  return {
    charLength: normalized.length,
    truncated,
    preview: truncated ? `${normalized.slice(0, limit)}...` : normalized,
  }
}

function stringifyAgentLoopLogValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined) return "undefined"
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`
  }
  if (typeof value === "symbol") return value.toString()

  const json = JSON.stringify(value, createAgentLoopLogJsonReplacer())
  return json ?? String(value)
}

function createAgentLoopLogJsonReplacer(): (
  key: string,
  value: unknown,
) => unknown {
  const seenObjects = new WeakSet<object>()
  return (_key: string, value: unknown): unknown => {
    if (typeof value === "bigint") return value.toString()
    if (typeof value === "function") {
      return `[Function ${value.name || "anonymous"}]`
    }
    if (typeof value === "symbol") return value.toString()
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
      }
    }
    if (!value || typeof value !== "object") return value
    if (seenObjects.has(value)) return "[Circular]"
    seenObjects.add(value)
    return value
  }
}

function truncateAgentLoopLogText(value: string, limit: number): string {
  const normalized = redactRawUrls(value).replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

function truncateAgentLoopLogTextOrNull(
  value: string | null,
  limit: number,
): string | null {
  return value === null ? null : truncateAgentLoopLogText(value, limit)
}

function getRecordFromUnknown(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Readonly<Record<string, unknown>>
}

function getRecordString(
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const value = record?.[key]
  return typeof value === "string" ? value : null
}

function getRecordNumber(
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): number | null {
  const value = record?.[key]
  return typeof value === "number" ? value : null
}

function getRecordBoolean(
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): boolean | null {
  const value = record?.[key]
  return typeof value === "boolean" ? value : null
}

function getRecordArray(
  record: Readonly<Record<string, unknown>> | null,
  key: string,
): readonly unknown[] {
  const value = record?.[key]
  return Array.isArray(value) ? value : []
}

function getFirstRecordValue(
  record: Readonly<Record<string, unknown>> | null,
  keys: readonly string[],
): unknown {
  const matchingKey = keys.find((key): boolean => record?.[key] !== undefined)
  return matchingKey ? record?.[matchingKey] : undefined
}

function getFirstRecordString(
  record: Readonly<Record<string, unknown>> | null,
  keys: readonly string[],
): string {
  const value = getFirstRecordValue(record, keys)
  return typeof value === "string" ? value : ""
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

function buildRetrievalToolOutput(response: AgenticRetrievalResponse): object {
  return {
    namespace: response.namespace,
    query: response.query,
    retrievalPlan: response.retrievalPlan ?? null,
    routerUsed: response.routerUsed,
    stopReason: response.stopReason ?? null,
    failureReason: response.failureReason ?? null,
    answerText: response.answerText
      ? redactRawUrls(response.answerText)
      : response.answerText,
    resultCount: response.results.length,
    referencedChunkCount: response.referencedChunks.length,
    readableChunkCount: response.chunkReferences.length,
    hasEvidenceText: Boolean(response.evidenceText?.trim()),
    evidenceText: truncateSafeContextTextToLimit(
      response.evidenceText ?? "",
      TOOL_EVIDENCE_CHAR_LIMIT,
    ),
    results: response.chunkReferences
      .filter((reference): boolean => reference.kind === "result")
      .map(formatToolResultReference),
    referencedChunks: response.referencedChunks.map(formatToolReferencedChunk),
    chunkReferences: response.chunkReferences.map(formatToolChunkReference),
    decisionTrace:
      response.decisionTrace
        ?.slice(-6)
        .map((trace) => redactRawUrlsFromUnknown(trace)) ?? [],
    agentGuidance: getRetrievalResponseGuidance(response),
  }
}

function formatToolResultReference(reference: RetrievedChunkReference): object {
  return {
    id: reference.id,
    chunkId: reference.chunkId,
    resultIndex: reference.resultIndex,
    chunkType: reference.chunkType,
    score: reference.score,
    hasAssetUrl: reference.hasAssetUrl,
    contentLength: reference.contentLength,
    contentTruncated: reference.contentTruncated,
    source: {
      documentId: reference.source.documentId ?? null,
      sourceFileName: reference.source.sourceFileName
        ? redactRawUrls(reference.source.sourceFileName)
        : null,
      sectionPath: reference.source.sectionPath
        ? redactRawUrls(reference.source.sectionPath)
        : null,
    },
    contentPreview: truncateSafeContextTextToLimit(
      reference.contentPreview,
      TOOL_RESULT_CONTENT_CHAR_LIMIT,
    ),
    content: truncateSafeContextTextToLimit(
      reference.contentPreview,
      TOOL_RESULT_CONTENT_CHAR_LIMIT,
    ),
  }
}

function formatToolReferencedChunk(chunk: RetrievalReferencedChunk): object {
  return {
    id: chunk.chunkId,
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    chunkType: chunk.chunkType,
    sectionPath: redactRawUrls(chunk.sectionPath),
    filePath: chunk.filePath ? redactRawUrls(chunk.filePath) : null,
    hasAssetUrl: Boolean(chunk.assetUrl),
  }
}

function formatToolChunkReference(reference: RetrievedChunkReference): object {
  return {
    id: reference.id,
    chunkId: reference.chunkId,
    kind: reference.kind,
    resultIndex: reference.resultIndex,
    chunkType: reference.chunkType,
    score: reference.score,
    hasAssetUrl: reference.hasAssetUrl,
    contentLength: reference.contentLength,
    contentTruncated: reference.contentTruncated,
    source: {
      documentId: reference.source.documentId ?? null,
      sourceFileName: reference.source.sourceFileName
        ? redactRawUrls(reference.source.sourceFileName)
        : null,
      sectionPath: reference.source.sectionPath
        ? redactRawUrls(reference.source.sectionPath)
        : null,
    },
  }
}

function buildRetrievedChunkToolOutput(
  result: ReadRetrievedChunkResult,
): object {
  return {
    id: result.id,
    chunkId: result.chunkId,
    found: result.found,
    chunkType: result.chunkType,
    score: result.score,
    source: result.source
      ? {
          documentId: result.source.documentId ?? null,
          sourceFileName: result.source.sourceFileName
            ? redactRawUrls(result.source.sourceFileName)
            : null,
          sectionPath: result.source.sectionPath
            ? redactRawUrls(result.source.sectionPath)
            : null,
        }
      : null,
    hasAssetUrl: result.hasAssetUrl,
    offset: result.offset,
    limit: result.limit,
    contentLength: result.contentLength,
    contentSlice: redactRawUrls(result.contentSlice),
    hasMoreContent: result.hasMoreContent,
    nextOffset: result.nextOffset,
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
