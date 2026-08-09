import type { ChatCitationView } from "@/domains/chat/types"
import type {
  ChunkType,
  ParsedChunkConnection,
  ParsedChunkView,
} from "@/domains/chunks/types"

type ParsedChunkNormalizationInput = {
  readonly chunkId: string
  readonly parserChunkId?: unknown
  readonly documentId?: string
  readonly sectionPath?: string | null
  readonly chunkType: unknown
  readonly contentSource?: unknown
  readonly content?: unknown
  readonly metadata: Readonly<Record<string, unknown>>
  readonly filePathCandidates?: readonly unknown[]
  readonly assetUrl?: unknown
  readonly assetUrlsByFilePath?: Readonly<Record<string, string>>
  readonly sourceTitle: string
}

function createParsedChunkView(
  input: ParsedChunkNormalizationInput,
): ParsedChunkView {
  const filePath = getFirstString(input.filePathCandidates ?? [])
  const assetUrl =
    (filePath ? input.assetUrlsByFilePath?.[filePath] : undefined) ??
    getString(input.assetUrl)
  const connections = getChunkConnections(input.metadata)
  const type = normalizeChunkType(input.chunkType)
  const content = normalizeChunkContent({
    type,
    content: input.content,
    metadata: input.metadata,
  })
  const summary = getStringMetadata(input.metadata, "summary")

  return {
    chunkId: input.chunkId,
    documentId: input.documentId,
    parserChunkId: getString(input.parserChunkId),
    sectionPath: input.sectionPath,
    type,
    content,
    contentSource: getContentSource(input),
    readableContent: getReadableContent({ type, content, summary }),
    filePath,
    assetUrl,
    summary,
    keywords: getStringArrayMetadata(input.metadata, "keywords"),
    pageNums: getPageNumbers(
      input.metadata["pageNums"] ?? input.metadata["page_nums"],
    ),
    entities: getEntities(input.metadata["entities"]),
    connections,
    sourceTitle: input.sourceTitle,
  }
}

function resolveConnectionTargets(
  chunks: readonly ParsedChunkView[],
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

function resolveCitationChunk(
  citation: ChatCitationView,
  chunks: readonly ParsedChunkView[],
): ParsedChunkView | null {
  const documentChunks = getCitationDocumentChunks(citation, chunks)
  const byId = findUniqueByChunkId(documentChunks, citation.chunkId)
  if (byId) return byId

  const byContent = findByContent(documentChunks, citation.content)
  if (byContent) return byContent

  const byPath = findUniqueBySectionPath(
    documentChunks,
    citation.source.sectionPath,
  )
  if (byPath) return byPath

  return null
}

function resolveCitationChunkByContent(
  citation: ChatCitationView,
  chunks: readonly ParsedChunkView[],
): ParsedChunkView | null {
  const documentChunks = getCitationDocumentChunks(citation, chunks)
  const byId = findUniqueByChunkId(documentChunks, citation.chunkId)
  if (byId) return byId

  return findByContent(documentChunks, citation.content)
}

function normalizeChunkType(value: unknown): ChunkType {
  if (value === "image" || value === "table" || value === "page") return value
  return "text"
}

function getContentSource(
  input: ParsedChunkNormalizationInput,
): string | undefined {
  return (
    getString(input.contentSource) ??
    getString(input.metadata["contentSource"]) ??
    getString(input.metadata["content_source"])
  )
}

function normalizeChunkContent(input: {
  readonly type: ChunkType
  readonly content?: unknown
  readonly metadata: Readonly<Record<string, unknown>>
}): string {
  const content = getString(input.content)
  if (content) return content
  if (input.type !== "page") return ""

  return getStringMetadata(input.metadata, "summary") ?? ""
}

function getReadableContent(input: {
  readonly type: ChunkType
  readonly content: string
  readonly summary?: string
}): string | undefined {
  if (input.type !== "page") return undefined
  return input.content || input.summary || undefined
}

function getChunkConnections(
  metadata: Readonly<Record<string, unknown>>,
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

function findUniqueByChunkId(
  chunks: readonly ParsedChunkView[],
  chunkId: string | undefined,
): ParsedChunkView | null {
  if (!chunkId) return null
  const matches = chunks.filter((chunk) => chunk.parserChunkId === chunkId)
  return matches.length === 1 ? matches[0]! : null
}

function findUniqueBySectionPath(
  chunks: readonly ParsedChunkView[],
  sectionPath: string | null | undefined,
): ParsedChunkView | null {
  if (!sectionPath) return null
  const normalized = normalizeText(sectionPath)
  const matches = chunks.filter(
    (chunk) => normalizeText(chunk.sectionPath ?? "") === normalized,
  )
  return matches.length === 1 ? matches[0]! : null
}

function getCitationDocumentChunks(
  citation: ChatCitationView,
  chunks: readonly ParsedChunkView[],
): readonly ParsedChunkView[] {
  if (!citation.source.documentId) return chunks
  return chunks.filter((chunk) => chunk.documentId === citation.source.documentId)
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

function getFirstString(values: readonly unknown[]): string | undefined {
  return values.reduce<string | undefined>(
    (selected, value) => selected ?? getString(value),
    undefined,
  )
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getStringMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  return getString(metadata[key])
}

function getStringArrayMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string[] | undefined {
  const value = metadata[key]
  if (!Array.isArray(value)) return undefined

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  )
  return strings.length > 0 ? strings : undefined
}

function getEntities(
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] | undefined {
  if (!Array.isArray(value)) return undefined

  const entities = value.filter(isRecord)
  return entities.length > 0 ? entities : undefined
}

function getPageNumbers(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined

  const pageNumbers = value.filter(
    (pageNumber): pageNumber is number =>
      Number.isInteger(pageNumber) && pageNumber > 0,
  )
  const uniquePageNumbers = Array.from(new Set(pageNumbers)).sort(
    (left, right) => left - right,
  )

  return uniquePageNumbers.length > 0 ? uniquePageNumbers : undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

export const parsedChunkNormalization = {
  createParsedChunkView,
  resolveCitationChunk,
  resolveCitationChunkByContent,
  resolveConnectionTargets,
} as const
