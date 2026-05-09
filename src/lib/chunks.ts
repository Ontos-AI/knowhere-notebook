import { Effect } from "effect"
import type { DocumentChunk, DocumentChunkType } from "@ontos-ai/knowhere-sdk"

import type { Source } from "./schema"
import type {
  ChatCitationView,
  ChunkType,
  ParsedChunkConnection,
  ParsedChunkView,
} from "./types"

const documentChunkPageSize = 200

export type ChunkKnowhereClient = {
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
        page?: number
        pageSize?: number
        total?: number
        totalPages?: number
      }
    }>
  }
}

export type LoadChunksOptions = {
  assetUrlsByFilePath?: Readonly<Record<string, string>>
}

export const loadChunksForSource = (
  source: Source,
  client: ChunkKnowhereClient,
  options: LoadChunksOptions = {},
) =>
  Effect.gen(function* () {
    if (source.status !== "ready" || !source.knowhereDocumentId) return []

    const chunks: DocumentChunk[] = []
    let page = 1
    let totalPages = 1

    do {
      const response = yield* Effect.promise(() =>
        client.documents.listChunks(source.knowhereDocumentId!, {
          page,
          pageSize: documentChunkPageSize,
          includeAssetUrls: true,
        }),
      )

      chunks.push(...response.chunks)
      totalPages = getTotalPages(response.pagination)
      page += 1
    } while (page <= totalPages)

    return resolveConnectionTargets(chunks.map((chunk) =>
      toParsedChunkView(
        chunk,
        source.title,
        source.knowhereDocumentId ?? undefined,
        options,
      ),
    ))
  })

export function toParsedChunkView(
  chunk: DocumentChunk,
  sourceTitle: string,
  documentId?: string,
  options: LoadChunksOptions = {},
): ParsedChunkView {
  const filePath = getChunkFilePath(chunk)
  const assetUrl =
    (filePath ? options.assetUrlsByFilePath?.[filePath] : undefined) ??
    getString(chunk.assetUrl)
  const connections = getChunkConnections(chunk.metadata)
  return {
    chunkId: chunk.id,
    documentId,
    parserChunkId: getString(chunk.chunkId),
    sectionPath: chunk.sectionPath,
    type: toChunkType(chunk.chunkType),
    content: chunk.content ?? "",
    filePath,
    assetUrl,
    summary: getStringMetadata(chunk.metadata, "summary"),
    keywords: getStringArrayMetadata(chunk.metadata, "keywords"),
    pageNums: getNumberArrayMetadata(chunk.metadata, "pageNums"),
    connections,
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
  const byContent = findByContent(documentChunks, citation.content)
  if (byContent) return byContent

  const byPath = findUniqueBySectionPath(
    documentChunks,
    citation.source.sectionPath,
  )
  if (byPath) return byPath

  return null
}

function toChunkType(chunkType: DocumentChunkType): ChunkType {
  if (chunkType === "image" || chunkType === "table") return chunkType
  return "text"
}

function getTotalPages(
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

function resolveConnectionTargets(
  chunks: ParsedChunkView[],
): ParsedChunkView[] {
  const chunkIdsByParserChunkId = new Map(
    chunks
      .filter((chunk) => chunk.parserChunkId)
      .map((chunk) => [chunk.parserChunkId!, chunk.chunkId]),
  )

  return chunks.map((chunk) => {
    if (!chunk.connections || chunk.connections.length === 0) return chunk

    return {
      ...chunk,
      connections: chunk.connections.map((connection) => ({
        ...connection,
        targetChunkId:
          chunkIdsByParserChunkId.get(connection.targetParserChunkId) ??
          connection.targetChunkId,
      })),
    }
  })
}

function getChunkFilePath(chunk: DocumentChunk): string | undefined {
  return (
    getString(chunk.filePath) ??
    getStringMetadata(chunk.metadata, "filePath") ??
    getStringMetadata(chunk.metadata, "file_path")
  )
}

function getChunkConnections(
  metadata: Record<string, unknown>,
): ParsedChunkConnection[] | undefined {
  const value = metadata["connectTo"] ?? metadata["connect_to"]
  if (!Array.isArray(value)) return undefined

  const connections = value.flatMap((item): ParsedChunkConnection[] => {
    if (!isRecord(item)) return []
    const targetParserChunkId = getString(item["target"])
    if (!targetParserChunkId) return []

    return [
      {
        targetParserChunkId,
        relation: getString(item["relation"]) ?? "related",
        ref: getString(item["ref"]),
        position: getConnectionPosition(item["position"]),
      },
    ]
  })

  return connections.length > 0 ? connections : undefined
}

function getConnectionPosition(
  value: unknown,
): ParsedChunkConnection["position"] | undefined {
  if (!isRecord(value)) return undefined
  const start = value["start"]
  const end = value["end"]
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return undefined
  }
  return { start, end }
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

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getStringMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  return getString(metadata[key])
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
