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
  readonly upsertPrefetchedChunks: (
    current: PrefetchedChunksBySourceId,
    sourceId: string,
    chunks: readonly ParsedChunkView[],
  ) => Record<string, ParsedChunkView[]>
}

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

function upsertPrefetchedChunks(
  current: PrefetchedChunksBySourceId,
  sourceId: string,
  chunks: readonly ParsedChunkView[],
): Record<string, ParsedChunkView[]> {
  return {
    ...current,
    [sourceId]: [...chunks],
  }
}

export const workspaceCitationState: WorkspaceCitationStateModule = {
  findCitationSource,
  getLoadedCitationChunkId,
  upsertPrefetchedChunks,
}
