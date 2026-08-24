"use client"

import { useCallback, useRef, useState } from "react"
import { useSWRConfig } from "swr"

import { workspaceCitationState } from "@/components/workspace-citation-state"
import { useWorkspaceSelectedChunks } from "@/components/workspace-selected-chunks"
import type { ChatCitationView, ChatImageHighlightBox } from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"
import {
  type FetchChunksOptions,
} from "@/domains/workspace/client"
import { workspaceClientCache } from "@/domains/workspace/client-cache"

type FocusedChunkState = {
  readonly chunkId: string | null
  readonly requestId: number
}

type FocusedPageState = {
  readonly pageNumber: number | null
  readonly requestId: number
  readonly citationId: string | null
  readonly highlightRegions: readonly ChatImageHighlightBox[]
}

type PrefetchedChunksBySourceId = Readonly<Record<string, ParsedChunkView[]>>
type PrefetchedChunksUpdater = (
  current: PrefetchedChunksBySourceId,
) => PrefetchedChunksBySourceId

type WorkspaceCitationFocusInput = {
  readonly fetchChunks: (
    sourceId: string,
    options?: FetchChunksOptions,
  ) => Promise<ParsedChunkView[]>
  readonly initialPrefetchedChunksBySourceId?: PrefetchedChunksBySourceId
  readonly onSelectSource: (sourceId: string | null) => void
  readonly selectedSourceId: string | null
  readonly sources: readonly SourceView[]
}

type WorkspaceCitationFocus = {
  readonly citationListViewRequestId: number
  readonly focusedChunk: FocusedChunkState
  readonly focusedPage: FocusedPageState
  readonly handleCitationClick: (
    citation: ChatCitationView,
    citationId: string,
    highlightRegions?: readonly ChatImageHighlightBox[],
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
  readonly selectedChunksMessage: string | null
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
  const [focusedPage, setFocusedPage] = useState<FocusedPageState>({
    pageNumber: null,
    requestId: 0,
    citationId: null,
    highlightRegions: [],
  })
  const [pendingCitationId, setPendingCitationId] = useState<string | null>(
    null,
  )
  const [citationListViewRequestId, setCitationListViewRequestId] =
    useState<number>(0)
  const [fullChunkLoadingSourceId, setFullChunkLoadingSourceId] = useState<
    string | null
  >(null)
  const { cache, mutate } = useSWRConfig()
  const partialPrefetchSourceIdsRef = useRef<Set<string>>(new Set())
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
    selectedChunksMessage,
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
  const requestPageFocus = useCallback(
    (
      pageNumber: number | null,
      citationId: string | null = null,
      highlightRegions: readonly ChatImageHighlightBox[] = [],
    ): void => {
      setFocusedPage((current) => ({
        pageNumber,
        citationId,
        highlightRegions: resolveFocusHighlightRegions(highlightRegions),
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
      requestPageFocus(null)
    },
    [
      onSelectSource,
      requestChunkFocus,
      requestPageFocus,
      selectedSourceId,
      updatePrefetchedChunksBySourceId,
    ],
  )

  const loadAllChunksForSource = useCallback(
    (
      sourceId: string,
      options?: FetchChunksOptions,
    ): Promise<ParsedChunkView[]> => {
      const existingRequest =
        fullChunkRequestsBySourceIdRef.current.get(sourceId)
      if (existingRequest) return existingRequest

      setFullChunkLoadingSourceId(sourceId)
      const source = sources.find((candidate) => candidate.id === sourceId)
      const chunkType =
        options?.chunkType ??
        (source?.documentPresentation?.kind === "page-assets"
          ? "page"
          : undefined)
      const fetchOptions: FetchChunksOptions | undefined = chunkType
        ? { chunkType, ...options }
        : options
      const request = (
        fetchOptions
          ? fetchChunks(sourceId, fetchOptions)
          : fetchChunks(sourceId)
      )
        .then((chunks) => {
          partialPrefetchSourceIdsRef.current.delete(sourceId)
          updatePrefetchedChunksBySourceId((current) =>
            workspaceCitationState.upsertPrefetchedChunks(
              current,
              sourceId,
              chunks,
            ),
          )
          workspaceClientCache.hydrateSourceChunks(
            (key, data) => {
              void mutate(key, data, { revalidate: false })
            },
            sourceId,
            chunks,
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
    [fetchChunks, mutate, sources, updatePrefetchedChunksBySourceId],
  )

  const handleLoadAllChunks = useCallback((): void => {
    if (!selectedSourceId) return

    const hasPartialPrefetch =
      partialPrefetchSourceIdsRef.current.has(selectedSourceId)
    if (
      !hasPartialPrefetch &&
      (prefetchedChunksBySourceIdRef.current[selectedSourceId] ||
        fullChunkRequestedSourceIdsRef.current.has(selectedSourceId) ||
        fullChunkRequestsBySourceIdRef.current.has(selectedSourceId))
    ) {
      return
    }

    fullChunkRequestedSourceIdsRef.current.add(selectedSourceId)
    const source = sources.find((candidate) => candidate.id === selectedSourceId)
    void loadAllChunksForSource(
      selectedSourceId,
      source?.documentPresentation?.kind === "page-assets"
        ? { chunkType: "page" }
        : undefined,
    )
  }, [loadAllChunksForSource, selectedSourceId, sources])

  const handleCitationClick = useCallback(
    async (
      citation: ChatCitationView,
      citationId: string,
      highlightRegions?: readonly ChatImageHighlightBox[],
    ): Promise<void> => {
      setPendingCitationId(citationId)

      try {
        const source = workspaceCitationState.findCitationSource(
          sources,
          citation,
        )
        if (!source) return

        setCitationListViewRequestId((current) => current + 1)
        const pageNumber = workspaceCitationState.getCitationPageNumber(citation)
        const isPageAssetSource =
          source.documentPresentation?.kind === "page-assets"

        const focusFromChunks = (
          chunks: readonly ParsedChunkView[],
          hasMore: boolean,
        ): string | null =>
          workspaceCitationState.getLoadedCitationChunkId({
            citation,
            selectedSourceId: source.id,
            sourceId: source.id,
            selectedChunks: chunks,
            hasMoreSelectedChunks: hasMore,
          })

        const applyFocus = (chunkId: string | null): void => {
          if (selectedSourceId !== source.id) onSelectSource(source.id)
          requestChunkFocus(chunkId)
          requestPageFocus(pageNumber, citationId, highlightRegions)
        }

        if (selectedSourceId === source.id) {
          const loadedChunkId = workspaceCitationState.getLoadedCitationChunkId({
            citation,
            selectedSourceId,
            sourceId: source.id,
            selectedChunks,
            hasMoreSelectedChunks,
          })
          if (loadedChunkId) {
            requestChunkFocus(loadedChunkId)
            requestPageFocus(pageNumber, citationId, highlightRegions)
            return
          }
        }

        const prefetchedChunks = prefetchedChunksBySourceIdRef.current[source.id]
        if (prefetchedChunks) {
          const prefetchedChunkId = focusFromChunks(prefetchedChunks, false)
          if (prefetchedChunkId) {
            applyFocus(prefetchedChunkId)
            return
          }
        }

        const swrChunks = workspaceClientCache.getCachedSourceChunks(
          cache,
          source.id,
        )
        if (swrChunks && swrChunks.length > 0) {
          const cachedChunkId = focusFromChunks(swrChunks, true)
          if (cachedChunkId) {
            applyFocus(cachedChunkId)
            return
          }
        }

        if (!workspaceCitationState.hasExactCitationTargetHint(citation)) {
          fullChunkRequestedSourceIdsRef.current.delete(source.id)
          updatePrefetchedChunksBySourceId((current) =>
            workspaceCitationState.removePrefetchedChunks(current, source.id),
          )
          if (selectedSourceId !== source.id) onSelectSource(source.id)
          requestChunkFocus(null)
          requestPageFocus(null)
          return
        }

        requestChunkFocus(null)
        const fetchOptions: FetchChunksOptions | undefined = isPageAssetSource
          ? {
              chunkType: "page",
              ...(pageNumber !== null ? { untilPageNumber: pageNumber } : {}),
            }
          : undefined
        const chunks =
          isPageAssetSource && pageNumber !== null
            ? await fetchChunks(source.id, fetchOptions)
            : await loadAllChunksForSource(source.id, fetchOptions)

        if (isPageAssetSource && pageNumber !== null) {
          if (!fullChunkRequestsBySourceIdRef.current.has(source.id)) {
            partialPrefetchSourceIdsRef.current.add(source.id)
            updatePrefetchedChunksBySourceId((current) =>
              workspaceCitationState.upsertPrefetchedChunks(
                current,
                source.id,
                chunks,
              ),
            )
            workspaceClientCache.hydrateSourceChunks(
              (key, data) => {
                void mutate(key, data, { revalidate: false })
              },
              source.id,
              chunks,
            )
          }
        }

        applyFocus(
          focusFromChunks(chunks, false),
        )
      } finally {
        setPendingCitationId((current) =>
          current === citationId ? null : current,
        )
      }
    },
    [
      cache,
      fetchChunks,
      hasMoreSelectedChunks,
      loadAllChunksForSource,
      mutate,
      onSelectSource,
      requestChunkFocus,
      requestPageFocus,
      selectedChunks,
      selectedSourceId,
      sources,
      updatePrefetchedChunksBySourceId,
    ],
  )

  return {
    citationListViewRequestId,
    focusedChunk,
    focusedPage,
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
    selectedChunksMessage,
    selectedChunks,
    selectedSource,
  }
}

function resolveFocusHighlightRegions(
  highlightRegions: readonly ChatImageHighlightBox[] | undefined,
): readonly ChatImageHighlightBox[] {
  if (highlightRegions && highlightRegions.length > 0) return highlightRegions
  return []
}
