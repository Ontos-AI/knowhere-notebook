import {
  resolveCitationChunk,
  resolveCitationChunkByContent,
} from "@/domains/chunks"
import type { ChatCitationView } from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"

type LoadedCitationChunkInput = {
  readonly citation: ChatCitationView
  readonly selectedSourceId: string | null
  readonly sourceId: string
  readonly selectedChunks: readonly ParsedChunkView[]
  readonly hasMoreSelectedChunks: boolean
}

type PrefetchedChunksBySourceId = Readonly<Record<string, ParsedChunkView[]>>

type WorkspaceCitationStateModule = {
  readonly findCitationSource: (
    sources: readonly SourceView[],
    citation: ChatCitationView,
  ) => SourceView | null
  readonly getLoadedCitationChunkId: (
    input: LoadedCitationChunkInput,
  ) => string | null
  readonly hasExactCitationTargetHint: (
    citation: ChatCitationView,
  ) => boolean
  readonly getCitationPageNumber: (citation: ChatCitationView) => number | null
  readonly upsertPrefetchedChunks: (
    current: PrefetchedChunksBySourceId,
    sourceId: string,
    chunks: readonly ParsedChunkView[],
  ) => Record<string, ParsedChunkView[]>
  readonly removePrefetchedChunks: (
    current: PrefetchedChunksBySourceId,
    sourceId: string,
  ) => PrefetchedChunksBySourceId
}

export const maxPrefetchedChunkSources = 5

function findCitationSource(
  sources: readonly SourceView[],
  citation: ChatCitationView,
): SourceView | null {
  return (
    sources.find(
      (source) => source.documentId === citation.source.documentId,
    ) ?? null
  )
}

function getLoadedCitationChunkId(
  input: LoadedCitationChunkInput,
): string | null {
  if (input.selectedSourceId !== input.sourceId) return null
  if (input.selectedChunks.length === 0) return null

  const focusedChunk = input.hasMoreSelectedChunks
    ? resolveCitationChunkByContent(input.citation, input.selectedChunks)
    : resolveCitationChunk(input.citation, input.selectedChunks)

  return (
    focusedChunk?.chunkId ??
    resolveCitationPageChunkId(input.citation, input.selectedChunks)
  )
}

function hasExactCitationTargetHint(citation: ChatCitationView): boolean {
  if (typeof citation.content === "string" && citation.content.trim().length > 0) {
    return true
  }

  if (
    getCitationPageNumber(citation) !== null ||
    typeof citation.pageCitationAssetUrl === "string"
  ) {
    return true
  }

  const sectionPath = citation.source.sectionPath
  if (typeof sectionPath !== "string") return false

  const trimmed = sectionPath.trim()
  if (trimmed.length === 0) return false
  if (trimmed === "Root") return false

  return true
}

function getCitationPageNumber(citation: ChatCitationView): number | null {
  if (
    typeof citation.pageCitationPageNumber === "number" &&
    Number.isSafeInteger(citation.pageCitationPageNumber) &&
    citation.pageCitationPageNumber > 0
  ) {
    return citation.pageCitationPageNumber
  }

  const sectionPath = citation.source.sectionPath
  if (typeof sectionPath !== "string") return null

  const match = /\bpage\s+(\d+)\b/i.exec(sectionPath)
  if (!match) return null

  const pageNumber = Number.parseInt(match[1]!, 10)
  return Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : null
}

function resolveCitationPageChunkId(
  citation: ChatCitationView,
  chunks: readonly ParsedChunkView[],
): string | null {
  const pageNumber = getCitationPageNumber(citation)
  if (pageNumber === null) return null

  const documentChunks = citation.source.documentId
    ? chunks.filter((chunk) => chunk.documentId === citation.source.documentId)
    : chunks
  const matches = documentChunks.filter((chunk) =>
    isChunkForPageNumber(chunk, pageNumber),
  )
  if (matches.length === 0) return null

  const pageAssetChunk = matches.find(
    (chunk) =>
      chunk.type === "page" &&
      (chunk.pageAssets ?? []).some(
        (pageAsset) => pageAsset.pageNumber === pageNumber,
      ),
  )

  return pageAssetChunk?.chunkId ?? matches[0]?.chunkId ?? null
}

function isChunkForPageNumber(
  chunk: ParsedChunkView,
  pageNumber: number,
): boolean {
  return (
    (chunk.pageAssets ?? []).some(
      (pageAsset) => pageAsset.pageNumber === pageNumber,
    ) || (chunk.pageNums ?? []).includes(pageNumber)
  )
}

function upsertPrefetchedChunks(
  current: PrefetchedChunksBySourceId,
  sourceId: string,
  chunks: readonly ParsedChunkView[],
): Record<string, ParsedChunkView[]> {
  const next: Record<string, ParsedChunkView[]> = {}

  for (const [existingSourceId, existingChunks] of Object.entries(current)) {
    if (existingSourceId === sourceId) continue
    next[existingSourceId] = existingChunks
  }
  next[sourceId] = [...chunks]

  const orderedKeys = Object.keys(next)
  if (orderedKeys.length <= maxPrefetchedChunkSources) return next

  const evictionCount = orderedKeys.length - maxPrefetchedChunkSources
  for (let index = 0; index < evictionCount; index += 1) {
    delete next[orderedKeys[index]!]
  }

  return next
}

function removePrefetchedChunks(
  current: PrefetchedChunksBySourceId,
  sourceId: string,
): PrefetchedChunksBySourceId {
  if (!Object.prototype.hasOwnProperty.call(current, sourceId)) return current

  const next: Record<string, ParsedChunkView[]> = {}
  for (const [existingSourceId, existingChunks] of Object.entries(current)) {
    if (existingSourceId === sourceId) continue
    next[existingSourceId] = existingChunks
  }
  return next
}

export const workspaceCitationState: WorkspaceCitationStateModule = {
  findCitationSource,
  getLoadedCitationChunkId,
  getCitationPageNumber,
  hasExactCitationTargetHint,
  upsertPrefetchedChunks,
  removePrefetchedChunks,
}
