import type {
  ParsedChunkConnection,
  ParsedChunkView,
} from "@/domains/chunks/types"

type RenderableReference = {
  readonly start: number
  readonly end: number
  readonly connection: ParsedChunkConnection
}

type ChunksPanelStateModule = {
  readonly formatChunkSectionPath: (
    sectionPath: ParsedChunkView["sectionPath"],
  ) => string | null
  readonly formatReferenceLabel: (ref: string) => string
  readonly getChunksWithFocusedFirst: (
    chunks: readonly ParsedChunkView[],
    focusedChunkId: string | null,
  ) => readonly ParsedChunkView[]
  readonly getReferenceLabel: (connection: ParsedChunkConnection) => string
  readonly getRenderableReferences: (
    chunk: ParsedChunkView,
  ) => RenderableReference[]
}

function getChunksWithFocusedFirst(
  chunks: readonly ParsedChunkView[],
  focusedChunkId: string | null,
): readonly ParsedChunkView[] {
  if (!focusedChunkId) return chunks

  const focusedIndex = chunks.findIndex(
    (chunk) => chunk.chunkId === focusedChunkId,
  )
  if (focusedIndex <= 0) return chunks

  const focusedChunk = chunks[focusedIndex]!
  return [
    focusedChunk,
    ...chunks.slice(0, focusedIndex),
    ...chunks.slice(focusedIndex + 1),
  ]
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
  formatReferenceLabel,
  getChunksWithFocusedFirst,
  getReferenceLabel,
  getRenderableReferences,
}
