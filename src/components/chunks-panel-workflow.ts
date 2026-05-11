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
  readonly handleOriginalViewSelected: () => void
  readonly handleParsedViewSelected: () => void
  readonly handleViewportScroll: UIEventHandler<HTMLDivElement>
  readonly hasOriginalFile: boolean
  readonly measureVirtualChunkElement: (node: HTMLDivElement | null) => void
  readonly requestChunkFocus: (chunkId: string) => void
  readonly totalHeight: number
  readonly viewportRef: RefObject<HTMLDivElement | null>
  readonly virtualItems: readonly VirtualItem[]
  readonly visibleChunks: readonly ParsedChunkView[]
  readonly visibleView: ChunksPanelView
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
  const [localFocusedChunkId, setLocalFocusedChunkId] = useState<string | null>(
    null,
  )
  const activeFocusedChunkId = focusedChunkId ?? localFocusedChunkId
  const hasOriginalFile = selectedSource !== null && selectedSourceFile !== null
  const visibleView = hasOriginalFile ? activeView : "parsed"
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

  const requestChunkFocus = useCallback((chunkId: string): void => {
    setLocalFocusedChunkId(chunkId)
  }, [])

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
  }, [activeFocusedChunkId, focusedChunkRequestId, scrollToFocusedChunk])

  useEffect(() => {
    if (!hasOriginalFile) setActiveView("parsed")
  }, [hasOriginalFile])

  useEffect(() => {
    if (focusedChunkId) setActiveView("parsed")
  }, [focusedChunkId, focusedChunkRequestId])

  return {
    activeFocusedChunkId,
    handleOriginalViewSelected,
    handleParsedViewSelected,
    handleViewportScroll,
    hasOriginalFile,
    measureVirtualChunkElement,
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
