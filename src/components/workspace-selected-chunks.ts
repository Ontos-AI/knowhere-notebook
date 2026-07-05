"use client"

import { useEffect, useMemo, useRef } from "react"
import useSWRInfinite from "swr/infinite"

import { workspaceClient } from "@/domains/workspace/client"
import {
  workspaceClientCache,
  type SourceChunksKey,
  type SourceChunksResponse,
} from "@/domains/workspace/client-cache"
import { resolveChunkConnectionTargets } from "@/domains/chunks"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"

type WorkspaceSelectedChunksInput = {
  readonly selectedSourceId: string | null
  readonly sources: readonly SourceView[]
  readonly prefetchedChunksBySourceId: Readonly<Record<string, ParsedChunkView[]>>
  readonly onRemoteSourceChunksLoaded?: (sourceId: string) => void
}

type WorkspaceSelectedChunks = {
  readonly hasMoreSelectedChunks: boolean
  readonly handleLoadMoreChunks: () => void
  readonly isSelectedChunksLoading: boolean
  readonly isSelectedChunksLoadingMore: boolean
  readonly selectedChunksMessage: string | null
  readonly selectedChunks: ParsedChunkView[]
  readonly selectedSource: SourceView | undefined
}

export function useWorkspaceSelectedChunks({
  selectedSourceId,
  sources,
  prefetchedChunksBySourceId,
  onRemoteSourceChunksLoaded,
}: WorkspaceSelectedChunksInput): WorkspaceSelectedChunks {
  const selectedSource = sources.find((source) => source.id === selectedSourceId)
  const remoteSourceRefreshRequestedIdsRef = useRef<Set<string>>(new Set())
  const prefetchedSelectedChunks = selectedSourceId
    ? prefetchedChunksBySourceId[selectedSourceId]
    : undefined
  const selectedChunkSourceId =
    selectedSource && selectedSource.status === "ready"
      ? selectedSource.id
      : null
  const {
    data: selectedChunkPages,
    isLoading: isChunksLoading,
    size: selectedChunkPageCount,
    setSize: setSelectedChunkPageCount,
  } = useSWRInfinite<SourceChunksResponse, Error>(
    (pageIndex: number, previousPageData: SourceChunksResponse | null) =>
      workspaceClientCache.getSourceChunksKey(
        selectedChunkSourceId,
        pageIndex,
        previousPageData,
      ),
    fetchChunksByKey,
    {
      revalidateIfStale: false,
      keepPreviousData: false,
      refreshInterval: (pages: readonly SourceChunksResponse[] | undefined) =>
        hasProcessingChunkPage(pages) ? 2_000 : 0,
    },
  )
  const selectedChunksMessage = getSelectedChunksMessage(selectedChunkPages)
  const pagedSelectedChunks = useMemo(
    () =>
      resolveChunkConnectionTargets(
        (selectedChunkPages ?? []).flatMap((page) => page.chunks ?? []),
      ),
    [selectedChunkPages],
  )
  const resolvedPrefetchedChunks = useMemo(
    () =>
      prefetchedSelectedChunks
        ? mergeVisibleChunkAssetUrls(
            resolveChunkConnectionTargets(prefetchedSelectedChunks),
            pagedSelectedChunks,
          )
        : undefined,
    [pagedSelectedChunks, prefetchedSelectedChunks],
  )
  const selectedChunks = selectedSourceId
    ? (resolvedPrefetchedChunks ?? pagedSelectedChunks)
    : []
  const hasMoreSelectedChunks =
    !prefetchedSelectedChunks &&
    workspaceClientCache.hasMoreChunkPages(selectedChunkPages)
  const isSelectedChunksLoadingMore =
    !prefetchedSelectedChunks &&
    Boolean(
      selectedChunkPageCount > 0 &&
        selectedChunkPages &&
        typeof selectedChunkPages[selectedChunkPageCount - 1] === "undefined",
    )
  const isSelectedChunksLoading =
    Boolean(selectedChunksMessage) ||
    (selectedChunkSourceId !== null &&
      !prefetchedSelectedChunks &&
      !selectedChunkPages &&
      isChunksLoading)

  useEffect(() => {
    const sourceId = selectedSource?.id
    if (!sourceId || selectedSource.kind !== "remote") return
    if (!selectedChunkPages || selectedChunkPages.length === 0) return
    if (remoteSourceRefreshRequestedIdsRef.current.has(sourceId)) return

    remoteSourceRefreshRequestedIdsRef.current.add(sourceId)
    onRemoteSourceChunksLoaded?.(sourceId)
  }, [onRemoteSourceChunksLoaded, selectedChunkPages, selectedSource])

  function handleLoadMoreChunks(): void {
    if (!hasMoreSelectedChunks || isSelectedChunksLoadingMore) return
    void setSelectedChunkPageCount(selectedChunkPageCount + 1)
  }

  return {
    hasMoreSelectedChunks,
    handleLoadMoreChunks,
    isSelectedChunksLoading,
    isSelectedChunksLoadingMore,
    selectedChunksMessage,
    selectedChunks,
    selectedSource,
  }
}

function fetchChunksByKey([
  ,
  sourceId,
  page,
]: SourceChunksKey): Promise<SourceChunksResponse> {
  return workspaceClient.fetchChunkPage(sourceId, page)
}

function hasProcessingChunkPage(
  pages: readonly SourceChunksResponse[] | undefined,
): boolean {
  return pages?.some((page) => page.isProcessing) ?? false
}

function getSelectedChunksMessage(
  pages: readonly SourceChunksResponse[] | undefined,
): string | null {
  const page = pages?.find(
    (candidate) =>
      candidate.isProcessing && typeof candidate.message === "string",
  )
  return page?.message ?? null
}

function mergeVisibleChunkAssetUrls(
  chunks: readonly ParsedChunkView[],
  visibleChunks: readonly ParsedChunkView[],
): ParsedChunkView[] {
  if (visibleChunks.length === 0) return [...chunks]

  const visibleChunksById = new Map(
    visibleChunks.map((chunk) => [chunk.chunkId, chunk]),
  )

  return chunks.map((chunk) => {
    if (chunk.assetUrl) return chunk

    const visibleChunk = visibleChunksById.get(chunk.chunkId)
    if (!visibleChunk?.assetUrl) return chunk

    return {
      ...chunk,
      assetUrl: visibleChunk.assetUrl,
    }
  })
}
