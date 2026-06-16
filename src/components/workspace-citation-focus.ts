"use client"

import { useCallback, useRef, useState } from "react"

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
type PrefetchedChunksUpdater = (
  current: PrefetchedChunksBySourceId,
) => PrefetchedChunksBySourceId

type WorkspaceCitationFocusInput = {
  readonly fetchChunks: (sourceId: string) => Promise<ParsedChunkView[]>
  readonly initialPrefetchedChunksBySourceId?: PrefetchedChunksBySourceId
  readonly onSelectSource: (sourceId: string | null) => void
  readonly selectedSourceId: string | null
  readonly sources: readonly SourceView[]
}

type WorkspaceCitationFocus = {
  readonly citationListViewRequestId: number
  readonly focusedChunk: FocusedChunkState
  readonly handleCitationClick: (
    citation: ChatCitationView,
    citationId: string,
  ) => Promise<void>
  readonly handleLoadMoreChunks: () => void
  readonly handleLoadAllChunks: () => void
  readonly handleSourceSelected: (sourceId: string | null) => void
  readonly hasMoreSelectedChunks: boolean
  readonly isSelectedAllChunksLoading: boolean
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
  const [citationListViewRequestId, setCitationListViewRequestId] =
    useState<number>(0)
  const [fullChunkLoadingSourceId, setFullChunkLoadingSourceId] = useState<
    string | null
  >(null)
  const fullChunkRequestsBySourceIdRef = useRef<
    Map<string, Promise<ParsedChunkView[]>>
  >(new Map())
  const fullChunkRequestedSourceIdsRef = useRef<Set<string>>(new Set())
  const [prefetchedChunksBySourceId, setPrefetchedChunksBySourceId] =
    useState<PrefetchedChunksBySourceId>(initialPrefetchedChunksBySourceId)
  const prefetchedChunksBySourceIdRef = useRef<PrefetchedChunksBySourceId>(
    initialPrefetchedChunksBySourceId,
  )
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

  const updatePrefetchedChunksBySourceId = useCallback(
    (updater: PrefetchedChunksUpdater): void => {
      const next = updater(prefetchedChunksBySourceIdRef.current)
      prefetchedChunksBySourceIdRef.current = next
      setPrefetchedChunksBySourceId(next)
    },
    [],
  )

  const handleSourceSelected = useCallback(
    (sourceId: string | null): void => {
      onSelectSource(sourceId)
      if (sourceId && sourceId !== selectedSourceId) {
        fullChunkRequestedSourceIdsRef.current.delete(sourceId)
        updatePrefetchedChunksBySourceId((current) =>
          workspaceCitationState.removePrefetchedChunks(current, sourceId),
        )
      }
      requestChunkFocus(null)
    },
    [
      onSelectSource,
      requestChunkFocus,
      selectedSourceId,
      updatePrefetchedChunksBySourceId,
    ],
  )

  const loadAllChunksForSource = useCallback(
    (sourceId: string): Promise<ParsedChunkView[]> => {
      const existingRequest =
        fullChunkRequestsBySourceIdRef.current.get(sourceId)
      if (existingRequest) return existingRequest

      setFullChunkLoadingSourceId(sourceId)
      const request = fetchChunks(sourceId)
        .then((chunks) => {
          updatePrefetchedChunksBySourceId((current) =>
            workspaceCitationState.upsertPrefetchedChunks(
              current,
              sourceId,
              chunks,
            ),
          )
          return chunks
        })
        .finally(() => {
          fullChunkRequestsBySourceIdRef.current.delete(sourceId)
          setFullChunkLoadingSourceId((current) =>
            current === sourceId ? null : current,
          )
        })

      fullChunkRequestsBySourceIdRef.current.set(sourceId, request)
      return request
    },
    [fetchChunks, updatePrefetchedChunksBySourceId],
  )

  const handleLoadAllChunks = useCallback((): void => {
    if (
      !selectedSourceId ||
      prefetchedChunksBySourceIdRef.current[selectedSourceId] ||
      fullChunkRequestedSourceIdsRef.current.has(selectedSourceId) ||
      fullChunkRequestsBySourceIdRef.current.has(selectedSourceId)
    ) {
      return
    }

    fullChunkRequestedSourceIdsRef.current.add(selectedSourceId)
    void loadAllChunksForSource(selectedSourceId)
  }, [
    loadAllChunksForSource,
    selectedSourceId,
  ])

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
        setCitationListViewRequestId((current) => current + 1)

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

        if (!workspaceCitationState.hasExactCitationTargetHint(citation)) {
          fullChunkRequestedSourceIdsRef.current.delete(source.id)
          updatePrefetchedChunksBySourceId((current) =>
            workspaceCitationState.removePrefetchedChunks(current, source.id),
          )
          if (selectedSourceId !== source.id) onSelectSource(source.id)
          requestChunkFocus(null)
          return
        }

        const cachedChunks = prefetchedChunksBySourceIdRef.current[source.id]
        if (cachedChunks) {
          const cachedFocusId =
            workspaceCitationState.getLoadedCitationChunkId({
              citation,
              selectedSourceId: source.id,
              sourceId: source.id,
              selectedChunks: cachedChunks,
              hasMoreSelectedChunks: false,
            })
          updatePrefetchedChunksBySourceId((current) =>
            workspaceCitationState.upsertPrefetchedChunks(
              current,
              source.id,
              cachedChunks,
            ),
          )
          if (selectedSourceId !== source.id) onSelectSource(source.id)
          requestChunkFocus(cachedFocusId)
          return
        }

        requestChunkFocus(null)
        const chunks = await loadAllChunksForSource(source.id)
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
      hasMoreSelectedChunks,
      loadAllChunksForSource,
      onSelectSource,
      requestChunkFocus,
      selectedChunks,
      selectedSourceId,
      sources,
      updatePrefetchedChunksBySourceId,
    ],
  )

  return {
    citationListViewRequestId,
    focusedChunk,
    handleCitationClick,
    handleLoadAllChunks,
    handleLoadMoreChunks,
    handleSourceSelected,
    hasMoreSelectedChunks,
    isSelectedAllChunksLoading: fullChunkLoadingSourceId === selectedSourceId,
    isSelectedChunksLoading,
    isSelectedChunksLoadingMore,
    pendingCitationId,
    prefetchedChunksBySourceId,
    requestChunkFocus,
    selectedChunks,
    selectedSource,
  }
}
