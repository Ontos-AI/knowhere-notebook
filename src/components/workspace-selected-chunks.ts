"use client"

import { useMemo } from "react"
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
}

type WorkspaceSelectedChunks = {
  readonly hasMoreSelectedChunks: boolean
  readonly handleLoadMoreChunks: () => void
  readonly isSelectedChunksLoading: boolean
  readonly isSelectedChunksLoadingMore: boolean
  readonly selectedChunks: ParsedChunkView[]
  readonly selectedSource: SourceView | undefined
}

export function useWorkspaceSelectedChunks({
  selectedSourceId,
  sources,
  prefetchedChunksBySourceId,
}: WorkspaceSelectedChunksInput): WorkspaceSelectedChunks {
  const selectedSource = sources.find((source) => source.id === selectedSourceId)
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
    },
  )
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
    selectedChunkSourceId !== null &&
    !prefetchedSelectedChunks &&
    !selectedChunkPages &&
    isChunksLoading

  function handleLoadMoreChunks(): void {
    if (!hasMoreSelectedChunks || isSelectedChunksLoadingMore) return
    void setSelectedChunkPageCount(selectedChunkPageCount + 1)
  }

  return {
    hasMoreSelectedChunks,
    handleLoadMoreChunks,
    isSelectedChunksLoading,
    isSelectedChunksLoadingMore,
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
