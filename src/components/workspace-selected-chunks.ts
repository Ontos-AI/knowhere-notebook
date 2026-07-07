"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWRInfinite from "swr/infinite"

import { workspaceClient } from "@/domains/workspace/client"
import {
  workspaceClientCache,
  type SourceChunksKey,
  type SourceChunksResponse,
  type SourcePageAssetsResponse,
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

type PageAssetProbeState =
  | { readonly status: "page-assets"; readonly pageCount: number }
  | { readonly status: "parsed-chunks" }

export function useWorkspaceSelectedChunks({
  selectedSourceId,
  sources,
  prefetchedChunksBySourceId,
  onRemoteSourceChunksLoaded,
}: WorkspaceSelectedChunksInput): WorkspaceSelectedChunks {
  const rawSelectedSource = sources.find(
    (source) => source.id === selectedSourceId,
  )
  const remoteSourceRefreshRequestedIdsRef = useRef<Set<string>>(new Set())
  const requestedPageAssetProbeIdsRef = useRef<Set<string>>(new Set())
  const [pageAssetProbeBySourceId, setPageAssetProbeBySourceId] = useState<
    Readonly<Record<string, PageAssetProbeState>>
  >({})
  const pageAssetProbeState = rawSelectedSource
    ? pageAssetProbeBySourceId[rawSelectedSource.id]
    : undefined
  const selectedSource =
    rawSelectedSource && pageAssetProbeState?.status === "page-assets"
      ? {
          ...rawSelectedSource,
          chunkCount: pageAssetProbeState.pageCount,
          documentPresentation: {
            kind: "page-assets" as const,
            pageCount: pageAssetProbeState.pageCount,
          },
        }
      : rawSelectedSource
  const prefetchedSelectedChunks = selectedSourceId
    ? prefetchedChunksBySourceId[selectedSourceId]
    : undefined
  const shouldProbePageAssets =
    rawSelectedSource !== undefined &&
    rawSelectedSource.status === "ready" &&
    rawSelectedSource.documentPresentation === undefined &&
    pageAssetProbeState === undefined
  const selectedChunkSourceId =
    selectedSource &&
    selectedSource.status === "ready" &&
    selectedSource.documentPresentation?.kind !== "page-assets" &&
    !shouldProbePageAssets
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
  const hasProcessingSelectedChunkPage =
    hasProcessingChunkPage(selectedChunkPages)
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
    shouldProbePageAssets ||
    hasProcessingSelectedChunkPage ||
    (selectedChunkSourceId !== null &&
      !prefetchedSelectedChunks &&
      !selectedChunkPages &&
      isChunksLoading)

  useEffect(() => {
    const source = rawSelectedSource
    if (!source || !shouldProbePageAssets) return
    if (requestedPageAssetProbeIdsRef.current.has(source.id)) return

    requestedPageAssetProbeIdsRef.current.add(source.id)
    void workspaceClient
      .fetchPageAssetPage(source.id, 1)
      .then((response) => {
        setPageAssetProbeBySourceId((current) => ({
          ...current,
          [source.id]: getPageAssetProbeState(response),
        }))

        if (source.kind === "remote" && (response.pages?.length ?? 0) > 0) {
          onRemoteSourceChunksLoaded?.(source.id)
        }
      })
      .catch(() => {
        requestedPageAssetProbeIdsRef.current.delete(source.id)
        setPageAssetProbeBySourceId((current) => ({
          ...current,
          [source.id]: { status: "parsed-chunks" },
        }))
      })
  }, [onRemoteSourceChunksLoaded, rawSelectedSource, shouldProbePageAssets])

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

function getPageAssetProbeState(
  response: SourcePageAssetsResponse,
): PageAssetProbeState {
  const pages = response.pages ?? []
  if (pages.length === 0) return { status: "parsed-chunks" }

  const maxPageNumber = Math.max(
    ...pages.map((page) => page.pageNumber),
  )
  const pageCount = Math.max(response.pagination?.total ?? 0, maxPageNumber)
  return { status: "page-assets", pageCount }
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
      (candidate.isProcessing || candidate.isUnavailable) &&
      typeof candidate.message === "string",
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
