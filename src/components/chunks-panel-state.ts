import type {
  ParsedChunkConnection,
  ParsedChunkView,
} from "@/domains/chunks/types"

type RenderableReference = {
  readonly start: number
  readonly end: number
  readonly connection: ParsedChunkConnection
}

type ChunkSectionTreeNodeKind = "root" | "section"

type ChunkSectionTreeNode = {
  readonly id: string
  readonly kind: ChunkSectionTreeNodeKind
  readonly label: string
  readonly chunks: readonly ParsedChunkView[]
  readonly children: readonly ChunkSectionTreeNode[]
  readonly chunkCount: number
}

type MutableChunkSectionTreeNode = {
  readonly id: string
  readonly kind: ChunkSectionTreeNodeKind
  readonly label: string
  readonly chunks: ParsedChunkView[]
  readonly children: MutableChunkSectionTreeNode[]
  readonly childrenByKey: Map<string, MutableChunkSectionTreeNode>
}

type ChunksPanelStateModule = {
  readonly buildSectionTree: (
    chunks: readonly ParsedChunkView[],
    sourceTitle: string,
  ) => ChunkSectionTreeNode
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

const knowhereArrowSectionSeparator = /--!?>/
const knowhereSectionSegmentSeparator = /--!?>|\/+/

function getChunksWithFocusedFirst(
  chunks: readonly ParsedChunkView[],
  focusedChunkId: string | null,
): readonly ParsedChunkView[] {
  if (!focusedChunkId) {
    return getChunksOrderedByPageNumber(dedupeChunksById(chunks))
  }

  // When a specific chunk is focused (citation click or tree leaf click),
  // show only that chunk — not the whole document reordered with it on top.
  const focusedChunk = dedupeChunksById(chunks).find(
    (chunk) => chunk.chunkId === focusedChunkId,
  )
  return focusedChunk ? [focusedChunk] : []
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

function buildSectionTree(
  chunks: readonly ParsedChunkView[],
  sourceTitle: string,
): ChunkSectionTreeNode {
  const uniqueChunks = dedupeChunksById(chunks)
  const root = createMutableSectionTreeNode({
    id: "root",
    kind: "root",
    label: sourceTitle.trim() || "Parsed Chunks",
  })
  const chunksByParserChunkId = new Map(
    uniqueChunks
      .filter((chunk) => chunk.parserChunkId)
      .map((chunk) => [chunk.parserChunkId!, chunk]),
  )
  const chunksByChunkId = new Map(
    uniqueChunks.map((chunk) => [chunk.chunkId, chunk]),
  )
  const sectionSegmentsByChunkId = new Map<string, readonly string[]>()

  uniqueChunks.forEach((chunk) => {
    const sectionSegments = getChunkSectionSegments(chunk, sourceTitle)
    if (sectionSegments.length > 0) {
      sectionSegmentsByChunkId.set(chunk.chunkId, sectionSegments)
    }
  })

  const embeddedSectionSegmentsByChunkId = getEmbeddedSectionSegmentsByChunkId({
    chunks: uniqueChunks,
    chunksByChunkId,
    chunksByParserChunkId,
    sectionSegmentsByChunkId,
  })

  uniqueChunks.forEach((chunk) => {
    const sectionSegments =
      embeddedSectionSegmentsByChunkId.get(chunk.chunkId) ??
      sectionSegmentsByChunkId.get(chunk.chunkId) ??
      getFallbackSectionSegments(chunk)
    addChunkToSection(root, sectionSegments, chunk)
  })

  return toReadonlySectionTreeNode(root)
}

function dedupeChunksById(
  chunks: readonly ParsedChunkView[],
): readonly ParsedChunkView[] {
  const seenChunkIds = new Set<string>()
  const uniqueChunks: ParsedChunkView[] = []

  chunks.forEach((chunk) => {
    if (seenChunkIds.has(chunk.chunkId)) return

    seenChunkIds.add(chunk.chunkId)
    uniqueChunks.push(chunk)
  })

  return uniqueChunks
}

function createMutableSectionTreeNode(input: {
  readonly id: string
  readonly kind: ChunkSectionTreeNodeKind
  readonly label: string
}): MutableChunkSectionTreeNode {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    chunks: [],
    children: [],
    childrenByKey: new Map(),
  }
}

function getEmbeddedSectionSegmentsByChunkId(input: {
  readonly chunks: readonly ParsedChunkView[]
  readonly chunksByChunkId: ReadonlyMap<string, ParsedChunkView>
  readonly chunksByParserChunkId: ReadonlyMap<string, ParsedChunkView>
  readonly sectionSegmentsByChunkId: ReadonlyMap<string, readonly string[]>
}): ReadonlyMap<string, readonly string[]> {
  const embeddedSectionSegmentsByChunkId = new Map<string, readonly string[]>()

  input.chunks.forEach((chunk) => {
    const sourceSectionSegments = input.sectionSegmentsByChunkId.get(
      chunk.chunkId,
    )
    if (!sourceSectionSegments || !chunk.connections) return

    chunk.connections.forEach((connection) => {
      const targetChunk =
        getConnectionTargetChunk(connection, input.chunksByChunkId) ??
        input.chunksByParserChunkId.get(connection.targetParserChunkId)
      if (!targetChunk) return

      if (!embeddedSectionSegmentsByChunkId.has(targetChunk.chunkId)) {
        embeddedSectionSegmentsByChunkId.set(
          targetChunk.chunkId,
          sourceSectionSegments,
        )
      }
    })
  })

  return embeddedSectionSegmentsByChunkId
}

function getConnectionTargetChunk(
  connection: ParsedChunkConnection,
  chunksByChunkId: ReadonlyMap<string, ParsedChunkView>,
): ParsedChunkView | undefined {
  return connection.targetChunkId
    ? chunksByChunkId.get(connection.targetChunkId)
    : undefined
}

function getChunkSectionSegments(
  chunk: ParsedChunkView,
  sourceTitle: string,
): readonly string[] {
  const sectionPath = chunk.sectionPath?.trim()
  if (!sectionPath) return []
  if (isAssetPath(sectionPath) && chunk.type !== "text") return []

  const segments = sectionPath
    .split(knowhereSectionSegmentSeparator)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  return removeDocumentRootSegments(segments, sourceTitle)
}

function removeDocumentRootSegments(
  segments: readonly string[],
  sourceTitle: string,
): readonly string[] {
  const remainingSegments = [...segments]

  if (remainingSegments[0] === "Default_Root") {
    remainingSegments.shift()
    if (remainingSegments.length > 1) {
      remainingSegments.shift()
    }
  }

  if (
    remainingSegments.length > 1 &&
    isSamePathSegment(remainingSegments[0]!, sourceTitle)
  ) {
    remainingSegments.shift()
  }

  return remainingSegments.length > 0 ? remainingSegments : ["Unsectioned"]
}

function isSamePathSegment(left: string, right: string): boolean {
  return normalizePathSegment(left) === normalizePathSegment(right)
}

function normalizePathSegment(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function isAssetPath(sectionPath: string): boolean {
  return (
    sectionPath.startsWith("images/") ||
    sectionPath.startsWith("image/") ||
    sectionPath.startsWith("tables/") ||
    sectionPath.startsWith("table/")
  )
}

function getFallbackSectionSegments(
  chunk: ParsedChunkView,
): readonly string[] {
  if (chunk.type === "page") return ["Pages"]
  if (chunk.type === "image") return ["Assets", "Images"]
  if (chunk.type === "table") return ["Assets", "Tables"]
  return ["Unsectioned"]
}

function addChunkToSection(
  root: MutableChunkSectionTreeNode,
  sectionSegments: readonly string[],
  chunk: ParsedChunkView,
): void {
  const targetSection = sectionSegments.reduce(
    (parent, sectionSegment) => getOrCreateChildSection(parent, sectionSegment),
    root,
  )
  targetSection.chunks.push(chunk)
}

function getOrCreateChildSection(
  parent: MutableChunkSectionTreeNode,
  label: string,
): MutableChunkSectionTreeNode {
  const key = normalizePathSegment(label)
  const existing = parent.childrenByKey.get(key)
  if (existing) return existing

  const child = createMutableSectionTreeNode({
    id: `${parent.id}/${key}`,
    kind: "section",
    label,
  })
  parent.childrenByKey.set(key, child)
  parent.children.push(child)
  return child
}

function toReadonlySectionTreeNode(
  node: MutableChunkSectionTreeNode,
): ChunkSectionTreeNode {
  const children = node.children.map(toReadonlySectionTreeNode)
  const childChunkCount = children.reduce(
    (total, child) => total + child.chunkCount,
    0,
  )

  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    chunks: [...node.chunks],
    children,
    chunkCount: node.chunks.length + childChunkCount,
  }
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
    .split(knowhereArrowSectionSeparator)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join(" / ")

  return readablePath.length > 0 ? readablePath : null
}

function removeKnowhereDefaultRootPrefix(sectionPath: string): string {
  const knowhereDefaultRootPrefix = "Default_Root/" as const
  if (!sectionPath.startsWith(knowhereDefaultRootPrefix)) return sectionPath

  const sectionSegments = sectionPath.split(knowhereArrowSectionSeparator)
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
  buildSectionTree,
  formatChunkSectionPath,
  formatReferenceLabel,
  getChunksWithFocusedFirst,
  getReferenceLabel,
  getRenderableReferences,
}
