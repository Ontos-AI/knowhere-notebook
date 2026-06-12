import { deriveChatThreadTitle } from "./title"
import type { ChatMessage, ChatThread } from "@/infrastructure/db/schema"
import type {
  ChatArtifactView,
  ChatCitationView,
  ChatMessageView,
  ChatThreadView,
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
  artifacts: readonly ChatArtifactView[] = [],
): ChatMessageView {
  const citationViews =
    citations.length > 0
      ? [...citations]
      : toPersistedCitationViews(message.citations)

  const artifactViews =
    artifacts.length > 0
      ? [...artifacts]
      : toPersistedArtifactViews(message.artifacts)

  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    citations: citationViews,
    ...(artifactViews && artifactViews.length > 0
      ? { artifacts: artifactViews }
      : {}),
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

  const artifacts = value.flatMap((item): ChatArtifactView[] => {
    if (!isRecord(item)) return []
    const type = getString(item.type)
    if (type !== "image" && type !== "table") return []

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
