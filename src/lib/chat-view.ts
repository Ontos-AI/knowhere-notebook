import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import { deriveChatThreadTitle } from "./chat-title"
import type { ChatMessage, ChatThread } from "./schema"
import type {
  ChatCitationView,
  ChatMessageView,
  ChatThreadView,
} from "./types"

export function toChatThreadView(thread: ChatThread): ChatThreadView {
  return {
    id: thread.id,
    title: deriveChatThreadTitle(thread.title ?? ""),
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  }
}

export function toChatMessageView(
  message: ChatMessage,
  citations: readonly RetrievalResult[] = [],
): ChatMessageView {
  const citationViews =
    citations.length > 0
      ? citations.map(toRetrievalResultView)
      : toPersistedCitationViews(message.citations)

  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    citations: citationViews,
  }
}

function toRetrievalResultView(result: RetrievalResult): ChatCitationView {
  return {
    content: result.content,
    chunkType: result.chunkType,
    score: result.score,
    assetUrl: result.assetUrl,
    source: {
      documentId: result.source.documentId,
      sourceFileName: result.source.sourceFileName,
      sectionPath: result.source.sectionPath,
    },
  }
}

function toPersistedCitationViews(value: unknown): ChatCitationView[] | undefined {
  if (!Array.isArray(value)) return undefined

  const citations = value.flatMap((item): ChatCitationView[] => {
    if (!isRecord(item) || !isRecord(item.source)) return []

    return [
      {
        chunkType: getString(item.chunkType) ?? "text",
        score: getNumber(item.score) ?? 0,
        assetUrl: getString(item.assetUrl),
        source: {
          documentId: getString(item.source.documentId),
          sourceFileName: getString(item.source.sourceFileName),
          sectionPath: getString(item.source.sectionPath),
        },
      },
    ]
  })

  return citations.length > 0 ? citations : undefined
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.length > 0 ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
