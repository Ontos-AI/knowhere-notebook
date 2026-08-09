import { Effect } from "effect"

import { getChatModel, getChatModelLabel, isChatConfigured } from "@/lib/ai"
import { logger } from "@/lib/logger"
import type { Source } from "@/infrastructure/db/schema"
import type { ChatCitationView } from "@/domains/chat/types"
import {
  runAgentHarness,
  type AgentTurn,
  type AgentTurnInput,
  type HarnessRetrievalRequest,
  type HarnessRunResult,
  type TargetModality,
} from "@/agent-harness"
import type {
  AgenticRetrievalQuery,
  AgenticRetrievalTargetContent,
  ChatHistoryMessage,
  SearchSources,
} from "./contracts"

const RECENT_CONTEXT_MESSAGE_LIMIT = 8
const CONTEXT_CONTENT_CHAR_LIMIT = 900
const SOURCE_CONTEXT_LIMIT = 12

type GenerateAgenticOutputManifestInput = {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  searchSources: SearchSources
}

export const generateAgenticOutputManifestEffect = (
  input: GenerateAgenticOutputManifestInput,
): Effect.Effect<HarnessRunResult, unknown> =>
  Effect.gen(function* () {
    if (!isChatConfigured()) {
      return yield* Effect.die(
        new Error(
          "Chat is not configured. Set either AI_GATEWAY_API_KEY " +
            "(Vercel AI Gateway) or CHAT_BASE_URL + CHAT_MODEL + CHAT_API_KEY " +
            "(OpenAI-compatible) in .env.local.",
        ),
      )
    }

    const turn = buildNotebookHarnessTurn(input)
    logger.info("chat-agent: harness request", {
      operation: "generateAgenticOutputManifest.initial",
      model: getChatModelLabel(),
      surface: turn.surface,
      recentTurnCount: turn.recentTurns.length,
      messageCharLength: turn.userText.length,
    })

    const result = yield* Effect.tryPromise(() =>
      runAgentHarness({
        model: getChatModel(),
        turn,
        retrieval: {
          query: (request) =>
            input.searchSources(toAgenticRetrievalQuery(request)),
        },
      }),
    )

    logger.info("chat-agent: harness response", {
      operation: "generateAgenticOutputManifest.final",
      model: getChatModelLabel(),
      answerLength: result.manifest.text.length,
      citationCount: result.manifest.citations.length,
      artifactCount: result.manifest.artifacts.length,
      unresolvedCount: result.manifest.unresolved.length,
      validationErrorCount: result.trace.validationErrors.length,
      intentTask: result.trace.intent?.task ?? null,
      carryHistory: result.trace.contextPolicy?.carryHistory ?? null,
    })
    return result
  })

export async function generateAgenticOutputManifest(
  input: GenerateAgenticOutputManifestInput,
): Promise<HarnessRunResult> {
  return Effect.runPromise(generateAgenticOutputManifestEffect(input))
}

function buildNotebookHarnessTurn(
  input: GenerateAgenticOutputManifestInput,
): AgentTurnInput {
  return {
    surface: "notebook_chat",
    userText: input.question,
    recentTurns: buildNotebookHarnessRecentTurns(input.messages),
    sourceContext: formatSourceContext(input.sources, input.excludedSourceIds),
    outputCapabilities: {
      text: true,
      image: true,
      table: true,
    },
  }
}

function buildNotebookHarnessRecentTurns(
  messages: readonly ChatHistoryMessage[],
): AgentTurn[] {
  return messages.slice(-RECENT_CONTEXT_MESSAGE_LIMIT).map((message, index) => ({
    id: `history_${Math.max(messages.length - RECENT_CONTEXT_MESSAGE_LIMIT, 0) + index + 1}`,
    role: message.role,
    contentPreview: truncateContextText(message.content),
    content: message.content,
    citationLabels: getCitationLabels(message.citations ?? []),
  }))
}

function getCitationLabels(
  citations: readonly ChatCitationView[],
): readonly string[] {
  return formatCitationContext(citations)
    .split(";")
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
}

function toAgenticRetrievalQuery(
  request: HarnessRetrievalRequest,
): AgenticRetrievalQuery {
  return {
    query: request.query,
    targetContent: toAgenticRetrievalTargetContent(request.modalities),
    purpose: request.purpose,
    topK: request.topK,
    signalPaths: request.signalPaths,
    filterMode: request.filterMode,
    threshold: request.threshold,
  }
}

function toAgenticRetrievalTargetContent(
  modalities: readonly TargetModality[],
): AgenticRetrievalTargetContent {
  const requestedModalities = new Set(modalities)
  if (requestedModalities.has("page")) return "page"
  if (requestedModalities.has("image") && requestedModalities.has("text")) {
    return "text_image"
  }
  if (requestedModalities.has("table") && requestedModalities.has("text")) {
    return "text_table"
  }
  if (requestedModalities.has("image")) return "image"
  if (requestedModalities.has("table")) return "table"
  if (requestedModalities.has("text")) return "text"
  return "all"
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
