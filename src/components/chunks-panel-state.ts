import type {
  ParsedChunkConnection,
  ParsedChunkView,
} from "@/domains/chunks/types"

type RenderableReference = {
  readonly start: number
  readonly end: number
  readonly connection: ParsedChunkConnection
}

export type ChunkSearchMatch = {
  readonly chunkId: string
  readonly matchCount: number
}

type ChunksPanelStateModule = {
  readonly formatChunkSectionPath: (
    sectionPath: ParsedChunkView["sectionPath"],
  ) => string | null
  readonly getChunkSearchMatches: (
    chunks: readonly ParsedChunkView[],
    query: string,
  ) => readonly ChunkSearchMatch[]
  readonly formatReferenceLabel: (ref: string) => string
  readonly getChunksWithFocusedFirst: (
    chunks: readonly ParsedChunkView[],
    focusedChunkId: string | null,
  ) => readonly ParsedChunkView[]
  readonly getReferenceLabel: (connection: ParsedChunkConnection) => string
  readonly getRenderableReferences: (
    chunk: ParsedChunkView,
  ) => RenderableReference[]
  readonly normalizeChunkSearchQuery: (query: string) => string
}

function getChunksWithFocusedFirst(
  chunks: readonly ParsedChunkView[],
  focusedChunkId: string | null,
): readonly ParsedChunkView[] {
  const orderedChunks = getChunksOrderedByPageNumber(chunks)
  if (!focusedChunkId) return orderedChunks

  const focusedIndex = orderedChunks.findIndex(
    (chunk) => chunk.chunkId === focusedChunkId,
  )
  if (focusedIndex <= 0) return orderedChunks

  const focusedChunk = orderedChunks[focusedIndex]!
  return [
    focusedChunk,
    ...orderedChunks.slice(0, focusedIndex),
    ...orderedChunks.slice(focusedIndex + 1),
  ]
}

function getChunksOrderedByPageNumber(
  chunks: readonly ParsedChunkView[],
): readonly ParsedChunkView[] {
  return chunks
    .map((chunk, index) => ({
      chunk,
      index,
      firstPageNumber: getFirstPageNumber(chunk),
    }))
    .sort((left, right) => {
      if (left.firstPageNumber === null && right.firstPageNumber === null) {
        return left.index - right.index
      }
      if (left.firstPageNumber === null) return 1
      if (right.firstPageNumber === null) return -1
      if (left.firstPageNumber !== right.firstPageNumber) {
        return left.firstPageNumber - right.firstPageNumber
      }
      return left.index - right.index
    })
    .map(({ chunk }) => chunk)
}

function getFirstPageNumber(chunk: ParsedChunkView): number | null {
  const pageNumbers = chunk.pageNums ?? []
  const finitePageNumbers = pageNumbers.filter(
    (pageNumber) => Number.isFinite(pageNumber) && pageNumber >= 0,
  )
  if (finitePageNumbers.length === 0) return null
  return Math.min(...finitePageNumbers)
}

function formatChunkSectionPath(
  sectionPath: ParsedChunkView["sectionPath"],
): string | null {
  const trimmedSectionPath = sectionPath?.trim() ?? ""
  if (!trimmedSectionPath) return null

  const userVisiblePath = removeKnowhereDefaultRootPrefix(trimmedSectionPath)
  const readablePath = userVisiblePath
    .split("-->")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join(" / ")

  return readablePath.length > 0 ? readablePath : null
}

function removeKnowhereDefaultRootPrefix(sectionPath: string): string {
  const knowhereDefaultRootPrefix = "Default_Root/" as const
  if (!sectionPath.startsWith(knowhereDefaultRootPrefix)) return sectionPath

  const sectionSegments = sectionPath.split("-->")
  if (sectionSegments.length <= 1) {
    return sectionPath.slice(knowhereDefaultRootPrefix.length)
  }

  return sectionSegments.slice(1).join("-->")
}

function getRenderableReferences(
  chunk: ParsedChunkView,
): RenderableReference[] {
  if (!chunk.connections || chunk.connections.length === 0) return []

  const references = chunk.connections.flatMap(
    (connection): RenderableReference[] => {
      const range = getReferenceRange(chunk.content, connection)
      return range ? [{ ...range, connection }] : []
    },
  )

  const sorted = references.sort((a, b) => a.start - b.start)
  const nonOverlapping: RenderableReference[] = []
  let previousEnd = -1

  sorted.forEach((reference) => {
    if (reference.start < previousEnd) return
    nonOverlapping.push(reference)
    previousEnd = reference.end
  })

  return nonOverlapping
}

function getChunkSearchMatches(
  chunks: readonly ParsedChunkView[],
  query: string,
): readonly ChunkSearchMatch[] {
  const normalizedQuery = normalizeChunkSearchQuery(query)
  if (!normalizedQuery) return []

  return chunks.flatMap((chunk): ChunkSearchMatch[] => {
    const matchCount = countChunkSearchMatches(chunk, normalizedQuery)
    if (matchCount === 0) return []
    return [{ chunkId: chunk.chunkId, matchCount }]
  })
}

function normalizeChunkSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

function countChunkSearchMatches(
  chunk: ParsedChunkView,
  normalizedQuery: string,
): number {
  return getChunkSearchText(chunk).reduce(
    (total, text) => total + countTextMatches(text, normalizedQuery),
    0,
  )
}

function getChunkSearchText(chunk: ParsedChunkView): readonly string[] {
  return [
    chunk.content,
    chunk.summary ?? "",
    ...(chunk.keywords ?? []),
  ].filter((text) => text.trim().length > 0)
}

function countTextMatches(text: string, normalizedQuery: string): number {
  const normalizedText = text.toLocaleLowerCase()
  let count = 0
  let cursor = 0

  while (cursor < normalizedText.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, cursor)
    if (matchIndex < 0) return count

    count += 1
    cursor = matchIndex + normalizedQuery.length
  }

  return count
}

function getReferenceRange(
  content: string,
  connection: ParsedChunkConnection,
): { readonly start: number; readonly end: number } | null {
  const positioned = connection.position
  if (
    positioned &&
    positioned.start >= 0 &&
    positioned.end > positioned.start &&
    positioned.end <= content.length
  ) {
    return positioned
  }

  if (!connection.ref) return null
  const start = content.indexOf(connection.ref)
  if (start < 0) return null
  return { start, end: start + connection.ref.length }
}

function getReferenceLabel(connection: ParsedChunkConnection): string {
  const ref = connection.ref?.trim()
  if (!ref) return connection.targetParserChunkId
  return formatReferenceLabel(ref)
}

function formatReferenceLabel(ref: string): string {
  const cleanedReference = ref.replace(/^\[/, "").replace(/\]$/, "").trim()
  const pathWithoutQuery = cleanedReference.split(/[?#]/, 1)[0] ?? cleanedReference
  const fileName = pathWithoutQuery.split(/[\\/]/).filter(Boolean).at(-1)
  const baseName = fileName ?? pathWithoutQuery
  const withoutExtension = baseName.replace(
    /\.(?:csv|gif|htm|html|jpeg|jpg|md|pdf|png|svg|txt|webp)$/i,
    "",
  )

  const readableName = withoutExtension
    .replace(/_/g, " ")
    .replace(/-/g, getReadableDashReplacement)
    .replace(/^(image|table)\s+(\d+)/i, (_, type: string, index: string) =>
      `${capitalize(type)} ${index}`,
    )

  return capitalize(readableName.replace(/\s+/g, " ").trim())
}

function getReadableDashReplacement(
  _match: string,
  index: number,
  value: string,
): string {
  const previous = value.at(index - 1) ?? ""
  const next = value.at(index + 1) ?? ""
  return /\d/.test(previous) && /\d/.test(next) ? "-" : " "
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export const chunksPanelState: ChunksPanelStateModule = {
  formatChunkSectionPath,
  getChunkSearchMatches,
  formatReferenceLabel,
  getChunksWithFocusedFirst,
  getReferenceLabel,
  getRenderableReferences,
  normalizeChunkSearchQuery,
}
