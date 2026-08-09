import { deriveChatThreadTitle } from "./title"
import type { ChatMessage, ChatThread } from "@/infrastructure/db/schema"
import type {
  ChatArtifactView,
  ChatCitationView,
  ChatMessageView,
  ChatThreadView,
  RetrievalTraceView,
} from "@/domains/chat/types"

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
  citations: readonly ChatCitationView[] = [],
  artifacts?: readonly ChatArtifactView[],
  retrievalTrace?: RetrievalTraceView,
): ChatMessageView {
  const citationViews =
    citations.length > 0
      ? [...citations]
      : toPersistedCitationViews(message.citations)

  const artifactViews =
    artifacts !== undefined
      ? [...artifacts]
      : toPersistedArtifactViews(message.artifacts)

  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    citations: citationViews,
    ...(artifactViews !== undefined ? { artifacts: artifactViews } : {}),
    ...(retrievalTrace ? { retrievalTrace } : {}),
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
        chunkId: getString(item.chunkId),
        assetUrl: getString(item.assetUrl),
        description: getString(item.description),
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

function toPersistedArtifactViews(value: unknown): ChatArtifactView[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length === 0) return []

  const artifacts = value.flatMap((item): ChatArtifactView[] => {
    if (!isRecord(item)) return []
    const type = getString(item.type)
    if (type !== "image" && type !== "table" && type !== "derived_table") {
      return []
    }

    const citation =
      isRecord(item.citation) && isRecord(item.citation.source)
        ? {
            chunkType: getString(item.citation.chunkType) ?? "text",
            score: getNumber(item.citation.score) ?? 0,
            assetUrl: getString(item.citation.assetUrl),
            description: getString(item.citation.description),
            source: {
              documentId: getString(item.citation.source.documentId),
              sourceFileName: getString(item.citation.source.sourceFileName),
              sectionPath: getString(item.citation.source.sectionPath),
            },
          }
        : undefined

    if (type === "derived_table") {
      const title = getString(item.title)
      const columns = getStringArray(item.columns)
      const rows = getStringRows(item.rows)
      const sourceRefs = getStringArray(item.sourceRefs)

      if (
        !title ||
        !columns ||
        columns.length === 0 ||
        !rows ||
        !sourceRefs ||
        sourceRefs.length === 0
      ) {
        return []
      }

      return [
        {
          type,
          ref: getString(item.ref),
          title,
          columns,
          rows,
          sourceRefs,
          display: typeof item.display === "boolean" ? item.display : undefined,
          reason: getString(item.reason),
        },
      ]
    }

    return [
      {
        type,
        ref: getString(item.ref),
        assetUrl: getString(item.assetUrl),
        label: getString(item.label),
        display: typeof item.display === "boolean" ? item.display : undefined,
        reason: getString(item.reason),
        ...(citation ? { citation } : {}),
      },
    ]
  })

  return artifacts.length > 0 ? artifacts : undefined
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.length > 0 ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function getStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((item): item is string => typeof item === "string")) {
    return undefined
  }
  return value
}

function getStringRows(
  value: unknown,
): readonly (readonly string[])[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows = value.map(getStringArray)
  if (rows.some((row) => row === undefined)) return undefined
  return rows as readonly (readonly string[])[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
