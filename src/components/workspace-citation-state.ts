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

  return focusedChunk?.chunkId ?? null
}

function hasExactCitationTargetHint(citation: ChatCitationView): boolean {
  if (typeof citation.content === "string" && citation.content.trim().length > 0) {
    return true
  }

  const sectionPath = citation.source.sectionPath
  if (typeof sectionPath !== "string") return false

  const trimmed = sectionPath.trim()
  if (trimmed.length === 0) return false
  if (trimmed === "Root") return false

  return true
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
  hasExactCitationTargetHint,
  upsertPrefetchedChunks,
  removePrefetchedChunks,
}
