"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type UIEventHandler,
} from "react"
import {
  useVirtualizer,
  type VirtualItem,
} from "@tanstack/react-virtual"

import { chunksPanelState } from "@/components/chunks-panel-state"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceOriginalFileView } from "@/domains/sources/types"

type ChunksPanelView = "parsed" | "original"

type ChunksPanelWorkflowInput = {
  readonly chunks: readonly ParsedChunkView[]
  readonly selectedSource: string | null
  readonly selectedSourceFile: SourceOriginalFileView | null
  readonly focusedChunkId: string | null
  readonly focusedChunkRequestId: number
  readonly hasMoreChunks: boolean
  readonly isLoading: boolean
  readonly isLoadingMore: boolean
  readonly onLoadMore?: () => void
}

type ChunksPanelWorkflow = {
  readonly activeFocusedChunkId: string | null
  readonly handleChunkSelected: (chunk: ParsedChunkView) => void
  readonly handleOriginalViewSelected: () => void
  readonly handleParsedViewSelected: () => void
  readonly handleViewportScroll: UIEventHandler<HTMLDivElement>
  readonly hasOriginalFile: boolean
  readonly hasOriginalView: boolean
  readonly measureVirtualChunkElement: (node: HTMLDivElement | null) => void
  readonly originalTargetPageNumber: number | null
  readonly originalTargetPageRequestId: number
  readonly requestChunkFocus: (chunkId: string | null) => void
  readonly totalHeight: number
  readonly viewportRef: RefObject<HTMLDivElement | null>
  readonly virtualItems: readonly VirtualItem[]
  readonly visibleChunks: readonly ParsedChunkView[]
  readonly visibleView: ChunksPanelView
}

type LocalFocusedChunk = {
  readonly chunkId: string
  readonly parentRequestId: number
  readonly requestId: number
}

const estimatedChunkCardHeight = 220
const virtualListOverscan = 4
const infiniteScrollThreshold = 720

export function useChunksPanelWorkflow({
  chunks,
  selectedSource,
  selectedSourceFile,
  focusedChunkId,
  focusedChunkRequestId,
  hasMoreChunks,
  isLoading,
  isLoadingMore,
  onLoadMore,
}: ChunksPanelWorkflowInput): ChunksPanelWorkflow {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [activeView, setActiveView] = useState<ChunksPanelView>("parsed")
  const [localFocusedChunk, setLocalFocusedChunk] =
    useState<LocalFocusedChunk | null>(null)
  const [originalTargetPage, setOriginalTargetPage] = useState<{
    readonly pageNumber: number | null
    readonly requestId: number
  }>({
    pageNumber: null,
    requestId: 0,
  })
  const activeFocusedChunkId: string | null =
    localFocusedChunk?.parentRequestId === focusedChunkRequestId
      ? localFocusedChunk.chunkId
      : focusedChunkId
  const activeFocusedChunkRequestId: number =
    localFocusedChunk?.parentRequestId === focusedChunkRequestId
      ? localFocusedChunk.requestId
      : focusedChunkRequestId
  const hasOriginalView = selectedSource !== null
  const hasOriginalFile = selectedSource !== null && selectedSourceFile !== null
  const visibleView = hasOriginalView ? activeView : "parsed"
  const visibleChunks = useMemo(
    () => chunksPanelState.getChunksWithFocusedFirst(chunks, activeFocusedChunkId),
    [activeFocusedChunkId, chunks],
  )
  const getVirtualChunkKey = useCallback(
    (index: number): string | number => visibleChunks[index]?.chunkId ?? index,
    [visibleChunks],
  )
  const measureVirtualChunkHeight = useCallback(
    (element: HTMLDivElement): number => element.offsetHeight,
    [],
  )
  // TanStack Virtual owns scroll measurement callbacks; this hook is not memoized by React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const chunkVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: visibleChunks.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: getVirtualChunkKey,
    estimateSize: () => estimatedChunkCardHeight,
    measureElement: measureVirtualChunkHeight,
    overscan: virtualListOverscan,
  })
  const virtualItems = chunkVirtualizer.getVirtualItems()
  const totalHeight = chunkVirtualizer.getTotalSize()

  const requestMoreChunksIfNeeded = useCallback(
    (viewport: HTMLDivElement): void => {
      if (
        !onLoadMore ||
        !hasMoreChunks ||
        isLoading ||
        isLoadingMore ||
        !hasVisibleViewportSize(viewport)
      ) {
        return
      }

      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight

      if (distanceFromBottom <= infiniteScrollThreshold) {
        onLoadMore()
      }
    },
    [hasMoreChunks, isLoading, isLoadingMore, onLoadMore],
  )

  const handleViewportScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      requestMoreChunksIfNeeded(event.currentTarget)
    },
    [requestMoreChunksIfNeeded],
  )

  const scrollToFocusedChunk = useCallback((): void => {
    if (!activeFocusedChunkId) return

    chunkVirtualizer.scrollToOffset(0, {
      align: "start",
      behavior: "auto",
    })
    requestAnimationFrame(() => {
      chunkVirtualizer.scrollToOffset(0, {
        align: "start",
        behavior: "smooth",
      })
    })
  }, [activeFocusedChunkId, chunkVirtualizer])

  const measureVirtualChunkElement = useCallback(
    (node: HTMLDivElement | null): void => {
      chunkVirtualizer.measureElement(node)
    },
    [chunkVirtualizer],
  )

  const requestChunkFocus = useCallback((chunkId: string | null): void => {
    if (chunkId === null) {
      setLocalFocusedChunk(null)
      return
    }

    setLocalFocusedChunk((current: LocalFocusedChunk | null) => ({
      chunkId,
      parentRequestId: focusedChunkRequestId,
      requestId: (current?.requestId ?? 0) + 1,
    }))
  }, [focusedChunkRequestId])

  const handleChunkSelected = useCallback(
    (chunk: ParsedChunkView): void => {
      if (!hasOriginalFile) return

      const pageNumber = getFirstChunkPageNumber(chunk)
      setOriginalTargetPage((current) => ({
        pageNumber,
        requestId: current.requestId + 1,
      }))
      setActiveView("original")
    },
    [hasOriginalFile],
  )

  const handleParsedViewSelected = useCallback((): void => {
    setActiveView("parsed")
  }, [])

  const handleOriginalViewSelected = useCallback((): void => {
    setActiveView("original")
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    requestMoreChunksIfNeeded(viewport)
  }, [requestMoreChunksIfNeeded, totalHeight, visibleChunks.length])

  useEffect(() => {
    if (!activeFocusedChunkId) {
      return
    }

    scrollToFocusedChunk()
  }, [activeFocusedChunkId, activeFocusedChunkRequestId, scrollToFocusedChunk])

  useEffect(() => {
    if (!hasOriginalView) setActiveView("parsed")
  }, [hasOriginalView])

  useEffect(() => {
    if (focusedChunkId) setActiveView("parsed")
  }, [focusedChunkId, focusedChunkRequestId])

  useEffect(() => {
    setLocalFocusedChunk(null)
  }, [selectedSource])

  return {
    activeFocusedChunkId,
    handleChunkSelected,
    handleOriginalViewSelected,
    handleParsedViewSelected,
    handleViewportScroll,
    hasOriginalFile,
    hasOriginalView,
    measureVirtualChunkElement,
    originalTargetPageNumber: originalTargetPage.pageNumber,
    originalTargetPageRequestId: originalTargetPage.requestId,
    requestChunkFocus,
    totalHeight,
    viewportRef,
    virtualItems,
    visibleChunks,
    visibleView,
  }
}

function hasVisibleViewportSize(viewport: HTMLDivElement): boolean {
  return viewport.clientHeight > 0 && viewport.scrollHeight > 0
}

function getFirstChunkPageNumber(chunk: ParsedChunkView): number | null {
  const pageNumbers = chunk.pageNums ?? []
  const validPageNumbers = pageNumbers.filter(
    (pageNumber) => Number.isFinite(pageNumber) && pageNumber > 0,
  )
  if (validPageNumbers.length === 0) return null
  return Math.min(...validPageNumbers)
}
