import { Effect } from "effect"
import type { DocumentChunk, DocumentChunkType } from "@ontos-ai/knowhere-sdk"

import type { Source } from "./schema"
import type { ChatCitationView, ChunkType, ParsedChunkView } from "./types"

export type ChunkKnowhereClient = {
  documents: {
    listChunks(
      documentId: string,
      params: {
        page: number
        pageSize: number
        includeAssetUrls: boolean
      },
    ): Promise<{ chunks: DocumentChunk[] }>
  }
}

export const loadChunksForSource = (
  source: Source,
  client: ChunkKnowhereClient,
) =>
  Effect.gen(function* () {
    if (source.status !== "ready" || !source.knowhereDocumentId) return []

    const response = yield* Effect.promise(() =>
      client.documents.listChunks(source.knowhereDocumentId!, {
        page: 1,
        pageSize: 100,
        includeAssetUrls: true,
      }),
    )
    return response.chunks.map((chunk) =>
      toParsedChunkView(
        chunk,
        source.title,
        source.knowhereDocumentId ?? undefined,
      ),
    )
  })

export function toParsedChunkView(
  chunk: DocumentChunk,
  sourceTitle: string,
  documentId?: string,
): ParsedChunkView {
  return {
    chunkId: chunk.id,
    documentId,
    sectionPath: chunk.sectionPath,
    type: toChunkType(chunk.chunkType),
    content: chunk.content ?? "",
    summary: getStringMetadata(chunk.metadata, "summary"),
    keywords: getStringArrayMetadata(chunk.metadata, "keywords"),
    pageNums: getNumberArrayMetadata(chunk.metadata, "pageNums"),
    sourceTitle,
  }
}

export function resolveCitationChunk(
  citation: ChatCitationView,
  chunks: readonly ParsedChunkView[],
): ParsedChunkView | null {
  const documentChunks = chunks.filter(
    (chunk) =>
      !citation.source.documentId ||
      chunk.documentId === citation.source.documentId,
  )
  const byPath = findUniqueBySectionPath(
    documentChunks,
    citation.source.sectionPath,
  )
  if (byPath) return byPath

  return findByContent(documentChunks, citation.content)
}

function toChunkType(chunkType: DocumentChunkType): ChunkType {
  if (chunkType === "image" || chunkType === "table") return chunkType
  return "text"
}

function findUniqueBySectionPath(
  chunks: readonly ParsedChunkView[],
  sectionPath: string | undefined,
): ParsedChunkView | null {
  if (!sectionPath) return null
  const normalized = normalizeText(sectionPath)
  const matches = chunks.filter(
    (chunk) => normalizeText(chunk.sectionPath ?? "") === normalized,
  )
  return matches.length === 1 ? matches[0]! : null
}

function findByContent(
  chunks: readonly ParsedChunkView[],
  content: string | undefined,
): ParsedChunkView | null {
  if (!content) return null
  const normalizedContent = normalizeText(content)
  if (normalizedContent.length === 0) return null

  const excerpt = normalizedContent.slice(0, 160)
  const matches = chunks.filter((chunk) =>
    normalizeText(chunk.content).includes(excerpt),
  )
  return matches.length === 1 ? matches[0]! : null
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function getStringMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
}

function getStringArrayMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = metadata[key]
  if (!Array.isArray(value)) return undefined

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  )
  return strings.length > 0 ? strings : undefined
}

function getNumberArrayMetadata(
  metadata: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const value = metadata[key]
  if (!Array.isArray(value)) return undefined

  const numbers = value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item),
  )
  return numbers.length > 0 ? numbers : undefined
}
