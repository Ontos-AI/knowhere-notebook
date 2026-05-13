"use client"

import { useCallback, useState } from "react"

import { workspaceCitationState } from "@/components/workspace-citation-state"
import { useWorkspaceSelectedChunks } from "@/components/workspace-selected-chunks"
import type { ChatCitationView } from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"

type FocusedChunkState = {
  readonly chunkId: string | null
  readonly requestId: number
}

type PrefetchedChunksBySourceId = Readonly<Record<string, ParsedChunkView[]>>

type WorkspaceCitationFocusInput = {
  readonly fetchChunks: (sourceId: string) => Promise<ParsedChunkView[]>
  readonly initialPrefetchedChunksBySourceId?: PrefetchedChunksBySourceId
  readonly onSelectSource: (sourceId: string | null) => void
  readonly selectedSourceId: string | null
  readonly sources: readonly SourceView[]
}

type WorkspaceCitationFocus = {
  readonly focusedChunk: FocusedChunkState
  readonly handleCitationClick: (
    citation: ChatCitationView,
    citationId: string,
  ) => Promise<void>
  readonly handleLoadMoreChunks: () => void
  readonly handleSourceSelected: (sourceId: string | null) => void
  readonly hasMoreSelectedChunks: boolean
  readonly pendingCitationId: string | null
  readonly prefetchedChunksBySourceId: PrefetchedChunksBySourceId
  readonly requestChunkFocus: (chunkId: string | null) => void
  readonly isSelectedChunksLoading: boolean
  readonly isSelectedChunksLoadingMore: boolean
  readonly selectedChunks: ParsedChunkView[]
  readonly selectedSource: SourceView | undefined
}

export function useWorkspaceCitationFocus({
  fetchChunks,
  initialPrefetchedChunksBySourceId = {},
  onSelectSource,
  selectedSourceId,
  sources,
}: WorkspaceCitationFocusInput): WorkspaceCitationFocus {
  const [focusedChunk, setFocusedChunk] = useState<FocusedChunkState>({
    chunkId: null,
    requestId: 0,
  })
  const [pendingCitationId, setPendingCitationId] = useState<string | null>(
    null,
  )
  const [prefetchedChunksBySourceId, setPrefetchedChunksBySourceId] =
    useState<PrefetchedChunksBySourceId>(initialPrefetchedChunksBySourceId)
  const {
    hasMoreSelectedChunks,
    handleLoadMoreChunks,
    isSelectedChunksLoading,
    isSelectedChunksLoadingMore,
    selectedChunks,
    selectedSource,
  } = useWorkspaceSelectedChunks({
    selectedSourceId,
    sources,
    prefetchedChunksBySourceId,
  })

  const requestChunkFocus = useCallback(
    (chunkId: string | null): void => {
      setFocusedChunk((current) => ({
        chunkId,
        requestId: current.requestId + 1,
      }))
    },
    [],
  )

  const handleSourceSelected = useCallback(
    (sourceId: string | null): void => {
      onSelectSource(sourceId)
      if (sourceId) {
        setPrefetchedChunksBySourceId((current) =>
          removeRecordKey(current, sourceId),
        )
      }
      requestChunkFocus(null)
    },
    [onSelectSource, requestChunkFocus],
  )

  const handleCitationClick = useCallback(
    async (
      citation: ChatCitationView,
      citationId: string,
    ): Promise<void> => {
      setPendingCitationId(citationId)

      try {
        const source = workspaceCitationState.findCitationSource(
          sources,
          citation,
        )
        if (!source) return

        const loadedChunkId = workspaceCitationState.getLoadedCitationChunkId({
          citation,
          selectedSourceId,
          sourceId: source.id,
          selectedChunks,
          hasMoreSelectedChunks,
        })
        if (loadedChunkId) {
          requestChunkFocus(loadedChunkId)
          return
        }

        requestChunkFocus(null)
        const chunks = await fetchChunks(source.id)
        setPrefetchedChunksBySourceId((current) =>
          workspaceCitationState.upsertPrefetchedChunks(
            current,
            source.id,
            chunks,
          ),
        )
        const prefetchedChunkId =
          workspaceCitationState.getLoadedCitationChunkId({
            citation,
            selectedSourceId: source.id,
            sourceId: source.id,
            selectedChunks: chunks,
            hasMoreSelectedChunks: false,
          })
        onSelectSource(source.id)
        requestChunkFocus(prefetchedChunkId)
      } finally {
        setPendingCitationId((current) =>
          current === citationId ? null : current,
        )
      }
    },
    [
      fetchChunks,
      hasMoreSelectedChunks,
      onSelectSource,
      requestChunkFocus,
      selectedChunks,
      selectedSourceId,
      sources,
    ],
  )

  return {
    focusedChunk,
    handleCitationClick,
    handleLoadMoreChunks,
    handleSourceSelected,
    hasMoreSelectedChunks,
    isSelectedChunksLoading,
    isSelectedChunksLoadingMore,
    pendingCitationId,
    prefetchedChunksBySourceId,
    requestChunkFocus,
    selectedChunks,
    selectedSource,
  }
}

function removeRecordKey<TValue>(
  record: Readonly<Record<string, TValue>>,
  key: string,
): Record<string, TValue> {
  const nextRecord = { ...record }
  delete nextRecord[key]
  return nextRecord
}
