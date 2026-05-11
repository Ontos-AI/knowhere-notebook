"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type UIEventHandler,
} from "react";
import {
  useVirtualizer,
  type VirtualItem,
} from "@tanstack/react-virtual";
import { Layers } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SourceOriginalPreview } from "@/components/source-original-preview";
import { chunksPanelState } from "@/components/chunks-panel-state";
import { ParsedChunkCard } from "@/components/parsed-chunk-card";
import type { ParsedChunkView } from "@/domains/chunks/types";
import type { SourceOriginalFileView } from "@/domains/sources/types";
import { cn } from "@/lib/utils";

export type ChunksPanelProps = {
  chunks: ParsedChunkView[];
  selectedSource?: string | null;
  selectedSourceFile?: SourceOriginalFileView | null;
  focusedChunkId?: string | null;
  focusedChunkRequestId?: number;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMoreChunks?: boolean;
  onLoadMore?: () => void;
};

const estimatedChunkCardHeight = 220;
const virtualListOverscan = 4;
const infiniteScrollThreshold = 720;
export function ChunksPanel({
  chunks = [],
  selectedSource = null,
  selectedSourceFile = null,
  focusedChunkId = null,
  focusedChunkRequestId = 0,
  isLoading = false,
  isLoadingMore = false,
  hasMoreChunks = false,
  onLoadMore,
}: Partial<ChunksPanelProps> = {}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [activeView, setActiveView] = useState<"parsed" | "original">("parsed");
  const [localFocusedChunkId, setLocalFocusedChunkId] = useState<string | null>(
    null,
  );
  const activeFocusedChunkId = focusedChunkId ?? localFocusedChunkId;
  const visibleChunks = useMemo(
    () => chunksPanelState.getChunksWithFocusedFirst(chunks, activeFocusedChunkId),
    [activeFocusedChunkId, chunks],
  );
  const getVirtualChunkKey = useCallback(
    (index: number): string | number => visibleChunks[index]?.chunkId ?? index,
    [visibleChunks],
  );
  const measureVirtualChunkElement = useCallback(
    (element: HTMLDivElement): number => element.offsetHeight,
    [],
  );
  // TanStack Virtual owns scroll measurement callbacks; this component is not memoized by React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const chunkVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: visibleChunks.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: getVirtualChunkKey,
    estimateSize: () => estimatedChunkCardHeight,
    measureElement: measureVirtualChunkElement,
    overscan: virtualListOverscan,
  });
  const virtualItems = chunkVirtualizer.getVirtualItems();
  const totalHeight = chunkVirtualizer.getTotalSize();

  const requestMoreChunksIfNeeded = useCallback(
    (viewport: HTMLDivElement): void => {
      if (
        !onLoadMore ||
        !hasMoreChunks ||
        isLoading ||
        isLoadingMore ||
        !hasVisibleViewportSize(viewport)
      ) {
        return;
      }

      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;

      if (distanceFromBottom <= infiniteScrollThreshold) {
        onLoadMore();
      }
    },
    [hasMoreChunks, isLoading, isLoadingMore, onLoadMore],
  );

  const handleViewportScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      requestMoreChunksIfNeeded(event.currentTarget);
    },
    [requestMoreChunksIfNeeded],
  );

  const scrollToFocusedChunk = useCallback((): void => {
    if (!activeFocusedChunkId) return;
    // getChunksWithFocusedFirst moves the focused chunk to index 0 in
    // visibleChunks, so the virtual list renders it at position 0 in
    // the reordered array.  scrollToOffset(0) and scrollToIndex(0)
    // both land on the focused chunk.
    chunkVirtualizer.scrollToOffset(0, {
      align: "start",
      behavior: "auto",
    });
    requestAnimationFrame(() => {
      chunkVirtualizer.scrollToOffset(0, {
        align: "start",
        behavior: "smooth",
      });
    });
  }, [activeFocusedChunkId, chunkVirtualizer]);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    requestMoreChunksIfNeeded(viewport);
  }, [requestMoreChunksIfNeeded, totalHeight, visibleChunks.length]);

  useEffect(() => {
    if (!activeFocusedChunkId) {
      return;
    }

    scrollToFocusedChunk();
  }, [activeFocusedChunkId, focusedChunkRequestId, scrollToFocusedChunk]);

  const requestChunkFocus = useCallback((chunkId: string): void => {
    setLocalFocusedChunkId(chunkId);
  }, []);

  const headerTitle = focusedChunkId ? "Referenced Chunks" : "Parsed Chunks";
  const hasOriginalFile = selectedSource !== null && selectedSourceFile !== null;
  const visibleView = hasOriginalFile ? activeView : "parsed";

  const headerSubtitle = visibleView === "original" ? (
    selectedSource ? (
      <>
        Showing the original file for{" "}
        <span className="font-semibold italic text-foreground">
          {selectedSource}
        </span>
      </>
    ) : (
      "Select a source to preview its original file."
    )
  ) : focusedChunkId ? (
    <>Showing relevant chunks from the last answer.</>
  ) : selectedSource ? (
    <>
      Showing all parsed chunks from{" "}
      <span className="font-semibold italic text-foreground">
        {selectedSource}
      </span>
    </>
  ) : (
    "Select a source to see its parsed chunks."
  );

  useEffect(() => {
    if (!hasOriginalFile) setActiveView("parsed");
  }, [hasOriginalFile]);

  useEffect(() => {
    if (focusedChunkId) setActiveView("parsed");
  }, [focusedChunkId, focusedChunkRequestId]);

  return (
    <main
      data-testid="chunks-panel"
      className="z-0 flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">
            {visibleView === "original" ? "Original File" : headerTitle}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground sm:truncate">
            {headerSubtitle}
          </p>
        </div>
        {hasOriginalFile ? (
          <div className="flex shrink-0 rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setActiveView("parsed")}
              className={viewToggleClassName(visibleView === "parsed")}
            >
              Parsed
            </button>
            <button
              type="button"
              onClick={() => setActiveView("original")}
              className={viewToggleClassName(visibleView === "original")}
            >
              Original
            </button>
          </div>
        ) : null}
      </header>

      {visibleView === "original" ? (
        <ScrollArea className="flex-1" scrollbars="both">
          <SourceOriginalPreview
            sourceTitle={selectedSource ?? "Original file"}
            file={selectedSourceFile}
          />
        </ScrollArea>
      ) : (
        <ScrollArea
          className="flex-1"
          viewportRef={viewportRef}
          onViewportScroll={handleViewportScroll}
          scrollbars="both"
        >
          <div
            data-testid="chunks-scroll-content"
            className="mx-auto flex w-[90%] min-w-0 max-w-[1600px] flex-col items-center p-3 sm:p-6"
          >
            {isLoading ? (
              <LoadingChunks />
            ) : chunks.length === 0 ? (
              <EmptyChunks />
            ) : (
              <div
                className="relative w-full min-w-0"
                style={{ height: totalHeight }}
                aria-label="Parsed chunks"
              >
                {virtualItems.map((virtualItem) => (
                  <VirtualChunkRow
                    key={virtualItem.key}
                    virtualItem={virtualItem}
                    chunk={visibleChunks[virtualItem.index]}
                    focusedChunkId={activeFocusedChunkId}
                    measureElement={chunkVirtualizer.measureElement}
                    onReferenceClick={requestChunkFocus}
                  />
                ))}
              </div>
            )}
            {isLoadingMore && (
              <div className="py-4 text-center text-xs text-muted-foreground">
                Loading more parsed chunks...
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </main>
  );
}

function viewToggleClassName(isActive: boolean): string {
  return cn(
    "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
    isActive
      ? "bg-background text-foreground shadow-xs"
      : "text-muted-foreground hover:text-foreground",
  );
}

function EmptyChunks(): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center sm:py-20">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Layers className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">
        No parsed chunks to show yet
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Upload and process a source, then pick it from the sidebar to see its
        parsed chunks.
      </p>
    </div>
  );
}

function LoadingChunks(): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center sm:py-20">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Layers className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">Loading parsed chunks...</p>
    </div>
  );
}

function VirtualChunkRow({
  virtualItem,
  chunk,
  focusedChunkId,
  measureElement,
  onReferenceClick,
}: {
  virtualItem: VirtualItem;
  chunk: ParsedChunkView | undefined;
  focusedChunkId: string | null;
  measureElement: (node: HTMLDivElement | null) => void;
  onReferenceClick: (chunkId: string) => void;
}): ReactNode {
  if (!chunk) {
    return null;
  }

  const rowStyle: CSSProperties = {
    position: "absolute",
    transform: `translateY(${virtualItem.start}px)`,
    width: "100%",
  };

  return (
    <div
      ref={measureElement}
      data-index={virtualItem.index}
      style={rowStyle}
      className="w-full min-w-0 pb-3 sm:pb-4"
      data-chunk-id={chunk.chunkId}
      data-focused-chunk={chunk.chunkId === focusedChunkId ? "true" : undefined}
    >
      <ParsedChunkCard
        chunk={chunk}
        isFocused={chunk.chunkId === focusedChunkId}
        onReferenceClick={onReferenceClick}
      />
    </div>
  );
}

function hasVisibleViewportSize(viewport: HTMLDivElement): boolean {
  return viewport.clientHeight > 0 && viewport.scrollHeight > 0;
}
