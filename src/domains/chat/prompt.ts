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
  RetrievalSource,
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
const STORED_HISTORY_CHAR_BUDGET = 32_000
const AGENT_STEP_MESSAGE_LIMIT = 20
const AGENT_STEP_RECENT_MESSAGE_LIMIT = 12
const AGENT_STEP_CONTEXT_CHAR_BUDGET = 64_000
const SOURCE_CONTEXT_LIMIT = 12
const AGENTIC_SEARCH_STEP_LIMIT = 5
const TOOL_EVIDENCE_CHAR_LIMIT = 12_000
const TOOL_RESULT_CONTENT_CHAR_LIMIT = 1_500
const TOOL_CHUNK_READ_LIMIT_DEFAULT = 4_000
const TOOL_CHUNK_READ_LIMIT_MAX = 8_000
const AGENT_LOOP_TOOL_INPUT_LOG_LIMIT = 1_200
const AGENT_LOOP_TOOL_LOG_ENTRY_LIMIT = 4
const AGENT_REQUIRED_SEARCH_STEP_COUNT = 2
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
  readonly output: AgentLoopLogPreview
}

type AgentLoopReadChunkOutputLog = {
  readonly kind: "readRetrievedChunk"
  readonly output: AgentLoopLogPreview
}

type LlmModelMessageLog = {
  readonly role: string
  readonly contentCharLength: number
  readonly content: unknown
}

type RetrievalResponseWithDecisionData = AgenticRetrievalResponse & {
  readonly decision_trace?: unknown
  readonly decisionTree?: unknown
  readonly decision_tree?: unknown
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
    "Never output JSON metadata blocks for citations, images, tables, or media.",
    "Never mention asset_id, assetUrl, raw URLs, chunk ids, request-local ids, or retrieval internals.",
    "For image requests, answer briefly and let the UI render images from citation metadata.",
    "For send/show image requests, do not transcribe personal details from the image; do not list identity numbers, addresses, birth dates, or document fields unless the user explicitly asks for those details.",
    "Do not invent asset URLs; use only the retrieved media asset references listed below.",
    "If the sources are related but incomplete, answer what you can and briefly say what is not covered.",
    "Do not invent document-specific facts that are not in the sources.",
    "Use the recent conversation only to resolve references like \"this document\"; do not use it as factual evidence.",
    "Answer in a natural, friendly, and direct tone.",
    "Use GitHub-flavored Markdown when it improves readability, such as short lists, tables, or code blocks. Keep simple answers as plain sentences.",
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
    "Role",
    "You are a Notebook research agent that answers user questions from their uploaded sources.",
    "Use retrieved source evidence as the factual source of truth. Do not invent document-specific facts.",
    "",
    "Retrieval strategy",
    "You have two tools: searchSources and readRetrievedChunk.",
    "Use searchSources for source discovery. Its markdown output gives guidance, evidence, result previews, and Read IDs.",
    "Use readRetrievedChunk only when a relevant search result preview is too short and the markdown output shows a Read ID.",
    "Treat tool output like source notes from a remote index: inspect it, reason over it, then decide whether to answer, search again, or read more.",
    "",
    "Tool use rules",
    "1. Always call searchSources before writing a final answer.",
    "2. Make a second searchSources call before answering to double-check the retrieved data. Reuse the same core query or refine it with entities, document names, section paths, file paths, content types, or failure hints from the first output.",
    "3. Choose the content target from the user's request: broad questions use broad or text-only search, image requests use image or text+image search, and table requests use table or text+table search.",
    "4. Do not paste raw prior messages into searchSources.query. The query must be concise and contain only distilled search terms such as document title, person, topic, date, section path, or asset kind.",
    "5. Use one response to guide the next query: carry forward discovered people, organizations, document names, section paths, file paths, content types, and failure hints.",
    "6. After the verification search, if the markdown guidance says the evidence is useful and the evidence/results directly support the answer, stop searching and answer.",
    "7. If results are missing, weak, or do not cover the requested entity/topic/media/table, search again with a broader or more specific query.",
    "8. Use readRetrievedChunk selectively; do not read every result when the previews already answer the question.",
    "9. Stop after enough evidence or when further searches are unlikely to help; then clearly say what was not found and what retrieval context was missing.",
    "",
    "Media/table handling",
    "For image requests, search visual content directly or combine text and image evidence. If an initial text result identifies a relevant person or section but not an image asset, query again with that person/section plus the requested image concept, e.g. identity card / 身份证 / 公民身份证明.",
    "For table requests, search table content directly or combine text and table evidence.",
    "When retrieved image or table assets are relevant, cite the matching source label; the UI renders media from citation metadata.",
    "Do not invent asset URLs or describe hidden asset metadata.",
    "",
    "Final answer contract",
    "Conversation context is supplied as managed model messages. Use it only to resolve references like \"this document\" or \"those images\".",
    "Cite document sections in the answer, e.g. [文档名 / 章节名].",
    "Use existing [Source N: label] labels only when they are the clearest available citation form.",
    "Never output JSON metadata blocks for citations, images, tables, or media.",
    "Never mention asset_id, assetUrl, raw URLs, chunk ids, Read IDs, tool parameters, or retrieval internals.",
    "For image requests, answer briefly and let the UI render images from citation metadata.",
    "For send/show image requests, do not transcribe personal details from the image; do not list identity numbers, addresses, birth dates, or document fields unless the user explicitly asks for those details.",
    "Do not add unrelated personal details for send/show image requests unless the user asks.",
    "Use GitHub-flavored Markdown when it improves readability, such as short lists, tables, or code blocks. Keep simple answers as plain sentences.",
    "Start with the answer first. Keep answers concise unless the user asks for detail.",
    "",
    "Searchable sources",
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
        "It returns markdown source notes with guidance, evidence, previews, " +
        "and Read IDs for follow-up reads. Use it before answering and call it " +
        "again with refined text, media, or section-path queries when evidence is missing or weak.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            "A concise, self-contained retrieval query. Do not paste raw chat history or previous messages. Use only distilled terms such as document title, person, topic, date, section path, or asset kind when needed.",
          ),
        targetContent: z
          .enum([
            "all",
            "text",
            "image",
            "table",
            "text_image",
            "text_table",
          ])
          .optional()
          .describe(
            "The content type to retrieve: all, text, image, table, text_image, or text_table. Omit only when all content types are useful.",
          ),
        purpose: z
          .string()
          .min(1)
          .max(240)
          .optional()
          .describe(
            "Short reason this query is needed, such as finding an entity, locating an image asset, or verifying a citation.",
          ),
        topK: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Number of chunks to return. Defaults to 8."),
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
      execute: async (queryInput: AgenticRetrievalQuery) => {
        const output = buildRetrievalToolOutput(
          await input.searchSources(queryInput),
        )
        logToolMarkdownOutput("searchSources", output)
        return output
      },
    }),
    readRetrievedChunk: tool({
      description:
        "Read an offset/limit content slice from a Read ID shown in searchSources markdown. " +
        "Use this when a returned result preview is relevant and you want more data before answering.",
      inputSchema: z.object({
        id: z
          .string()
          .min(1)
          .describe(
            "The Read ID shown in searchSources markdown for a relevant result.",
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
      execute: async (readInput: ReadRetrievedChunkInput) => {
        const output = buildRetrievedChunkToolOutput(
          await input.readRetrievedChunk(readInput),
        )
        logToolMarkdownOutput("readRetrievedChunk", output)
        return output
      },
    }),
  } as const
}

function buildAgenticPrepareStep(
  instructions: string,
): PrepareStepFunction<AgenticChatTools> {
  return ({ stepNumber, messages }) => {
    const managedMessages = buildAgentStepMessages(messages)
    if (stepNumber < AGENT_REQUIRED_SEARCH_STEP_COUNT) {
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
    return {
      kind: "searchSources",
      output: buildAgentLoopFullMarkdownPreview(output),
    }
  }
  if (toolName === "readRetrievedChunk") {
    return {
      kind: "readRetrievedChunk",
      output: buildAgentLoopFullMarkdownPreview(output),
    }
  }
  return buildAgentLoopFullPreview(output)
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

function buildAgentLoopFullPreview(value: unknown): AgentLoopLogPreview {
  const normalized = redactRawUrls(stringifyAgentLoopLogValue(value))
  return {
    charLength: normalized.length,
    truncated: false,
    preview: normalized,
  }
}

function buildAgentLoopFullMarkdownPreview(value: unknown): AgentLoopLogPreview {
  const normalized = redactRawUrls(stringifyAgentLoopLogValue(value))
  return {
    charLength: normalized.length,
    truncated: false,
    preview: normalized,
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
    ...selectRecentMessagesWithinBudget({
      messages: nonSystemMessages,
      reservedCharLength: getModelMessagesCharLength(systemMessages),
      charBudget: AGENT_STEP_CONTEXT_CHAR_BUDGET,
      messageLimit: AGENT_STEP_RECENT_MESSAGE_LIMIT,
    }),
  ]
}

function selectRecentMessagesWithinBudget(input: {
  readonly messages: readonly ModelMessage[]
  readonly reservedCharLength: number
  readonly charBudget: number
  readonly messageLimit: number
}): ModelMessage[] {
  const selectedMessages: ModelMessage[] = []
  const remainingCharBudget = Math.max(
    input.charBudget - input.reservedCharLength,
    0,
  )
  let selectedCharLength = 0

  for (const message of [...input.messages].reverse()) {
    if (selectedMessages.length >= input.messageLimit) break

    const messageCharLength = getUnknownTextLength(message.content)
    const isLatestMessage = selectedMessages.length === 0
    const canFitWithinBudget =
      selectedCharLength + messageCharLength <= remainingCharBudget
    if (!isLatestMessage && !canFitWithinBudget) continue

    selectedMessages.push(message)
    selectedCharLength += messageCharLength
  }

  return selectedMessages.reverse()
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

function buildRetrievalToolOutput(response: AgenticRetrievalResponse): string {
  const resultReferences = response.chunkReferences.filter(
    (reference): boolean => reference.kind === "result",
  )
  const relatedReferences = response.chunkReferences.filter(
    (reference): boolean => reference.kind === "referencedChunk",
  )
  const lines = [
    "## Retrieval Result",
    "",
    `Query: ${redactRawUrls(response.query)}`,
    `Guidance: ${getRetrievalResponseGuidance(response)}`,
    "",
    "## Evidence",
    formatOptionalMarkdownText(response.evidenceText, "No evidence text returned."),
    "",
    ...formatDecisionTraceMarkdown(response),
    "## Results",
    ...formatResultReferencesMarkdown(resultReferences),
    "",
    "## Related Sources",
    ...formatRelatedReferencesMarkdown(relatedReferences),
  ]

  return lines.join("\n")
}

function formatDecisionTraceMarkdown(
  response: AgenticRetrievalResponse,
): readonly string[] {
  const decisionData = getDecisionTraceData(response)
  if (!decisionData) return []

  return [
    "## Decision Trace",
    ...formatDecisionValueMarkdown(decisionData, 0),
    "",
  ]
}

function getDecisionTraceData(response: AgenticRetrievalResponse): unknown | null {
  const record = response as RetrievalResponseWithDecisionData
  const candidates = [
    record.decisionTrace,
    record.decision_trace,
    record.decisionTree,
    record.decision_tree,
  ]

  return candidates.find(hasRenderableDecisionData) ?? null
}

function hasRenderableDecisionData(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "string") return value.trim().length > 0
  return Boolean(value && typeof value === "object")
}

function formatDecisionValueMarkdown(
  value: unknown,
  depth: number,
): readonly string[] {
  if (Array.isArray(value)) return formatDecisionArrayMarkdown(value, depth)
  if (value && typeof value === "object") {
    return formatDecisionRecordMarkdown(value as Record<string, unknown>, depth)
  }

  return [`${getDecisionIndent(depth)}- ${formatDecisionScalar(value)}`]
}

function formatDecisionArrayMarkdown(
  values: readonly unknown[],
  depth: number,
): readonly string[] {
  if (values.length === 0) return [`${getDecisionIndent(depth)}- none`]

  return values.flatMap((value, index): readonly string[] => {
    const label = depth === 0 ? `Step ${index + 1}` : `Item ${index + 1}`
    if (value && typeof value === "object") {
      return [
        `${getDecisionIndent(depth)}- ${label}:`,
        ...formatDecisionValueMarkdown(value, depth + 1),
      ]
    }
    return [
      `${getDecisionIndent(depth)}- ${label}: ${formatDecisionScalar(value)}`,
    ]
  })
}

function formatDecisionRecordMarkdown(
  record: Record<string, unknown>,
  depth: number,
): readonly string[] {
  const entries = Object.entries(record).filter(
    ([key, value]): boolean => shouldRenderDecisionEntry(key, value),
  )
  if (entries.length === 0) return [`${getDecisionIndent(depth)}- none`]

  return entries.flatMap(([key, value]): readonly string[] => {
    if (Array.isArray(value) || (value && typeof value === "object")) {
      return [
        `${getDecisionIndent(depth)}- ${key}:`,
        ...formatDecisionValueMarkdown(value, depth + 1),
      ]
    }
    return [
      `${getDecisionIndent(depth)}- ${key}: ${formatDecisionScalar(value)}`,
    ]
  })
}

function shouldRenderDecisionEntry(key: string, value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === "string" && value.trim().length === 0) return false

  return !isInternalDecisionField(key)
}

function isInternalDecisionField(key: string): boolean {
  return [
    "assetId",
    "asset_id",
    "assetUrl",
    "asset_url",
    "rawUrl",
    "raw_url",
    "presignedUrl",
    "presigned_url",
  ].includes(key)
}

function formatDecisionScalar(value: unknown): string {
  if (typeof value === "string") {
    return redactRawUrls(value).replace(/\s+/g, " ").trim()
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return redactRawUrls(String(value)).replace(/\s+/g, " ").trim()
}

function getDecisionIndent(depth: number): string {
  return "  ".repeat(depth)
}

function formatResultReferencesMarkdown(
  references: readonly RetrievedChunkReference[],
): readonly string[] {
  if (references.length === 0) return ["- No direct results returned."]

  return references.flatMap((reference, index): readonly string[] => [
    `### Result ${reference.resultIndex ?? index + 1}`,
    `Type: ${reference.chunkType}`,
    `Source: ${formatToolSourceLabel(reference.source)}`,
    `Media: ${formatMediaAvailability(reference)}`,
    `Read ID: ${reference.id}`,
    `More content available: ${reference.contentTruncated ? "yes" : "no"}`,
    "",
    "Preview:",
    formatMarkdownCodeBlock(
      truncateSafeContextTextToLimit(
        reference.contentPreview,
        TOOL_RESULT_CONTENT_CHAR_LIMIT,
      ) || "No preview text returned.",
    ),
    "",
  ])
}

function formatRelatedReferencesMarkdown(
  references: readonly RetrievedChunkReference[],
): readonly string[] {
  if (references.length === 0) return ["- No related sources returned."]

  return references.flatMap((reference, index): readonly string[] => [
    `### Related Source ${index + 1}`,
    `Type: ${reference.chunkType}`,
    `Source: ${formatToolSourceLabel(reference.source)}`,
    `Media: ${formatMediaAvailability(reference)}`,
    "",
  ])
}

function buildRetrievedChunkToolOutput(
  result: ReadRetrievedChunkResult,
): string {
  if (!result.found) {
    return [
      "## Retrieved Content",
      "",
      "Status: not_found",
      `Read ID: ${result.id}`,
      "Guidance: The requested Read ID was not found. Search again or use a Read ID shown in the latest retrieval result.",
    ].join("\n")
  }

  return [
    "## Retrieved Content",
    "",
    "Status: found",
    `Read ID: ${result.id}`,
    `Type: ${result.chunkType ?? "unknown"}`,
    `Source: ${result.source ? formatToolSourceLabel(result.source) : "Unknown source"}`,
    `Media: ${result.hasAssetUrl ? "available" : "none"}`,
    `Returned range: ${result.offset}-${result.offset + result.contentSlice.length} of ${result.contentLength} characters`,
    `More content available: ${result.hasMoreContent ? "yes" : "no"}`,
    ...(result.nextOffset === null ? [] : [`Next offset: ${result.nextOffset}`]),
    "",
    "## Content",
    formatMarkdownCodeBlock(redactRawUrls(result.contentSlice)),
  ].join("\n")
}

function formatOptionalMarkdownText(
  value: string | null | undefined,
  fallback: string,
): string {
  const normalized = truncateSafeMarkdownTextToLimit(
    value ?? "",
    TOOL_EVIDENCE_CHAR_LIMIT,
  )
  return formatMarkdownCodeBlock(normalized || fallback)
}

function formatMarkdownCodeBlock(value: string): string {
  return ["```text", value.replaceAll("```", "'''"), "```"].join("\n")
}

function formatToolSourceLabel(source: RetrievalSource): string {
  const label = [
    source.sourceFileName ? redactRawUrls(source.sourceFileName) : null,
    source.sectionPath ? redactRawUrls(source.sectionPath) : null,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" / ")

  return label || "Unknown source"
}

function formatMediaAvailability(reference: RetrievedChunkReference): string {
  if (!reference.hasAssetUrl) return "none"

  const chunkType = reference.chunkType.toLowerCase()
  if (chunkType === "image") return "image available"
  if (chunkType === "table") return "table available"
  return "media available"
}

function logToolMarkdownOutput(toolName: string, output: string): void {
  logger.info("chat-agent: tool output", {
    toolName,
    output: buildAgentLoopFullMarkdownPreview(output),
  })
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
      "or an image/table-focused content target if the user asked for images or tables."
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

function truncateSafeMarkdownTextToLimit(value: string, limit: number): string {
  const normalized = redactRawUrls(value).replace(/\r\n?/g, "\n")
  if (normalized.trim().length === 0) return ""
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
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
