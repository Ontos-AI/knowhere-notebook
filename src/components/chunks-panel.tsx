"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import { type VirtualItem } from "@tanstack/react-virtual";
import { FilePlus2, Layers, UploadCloud } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SourceOriginalPreview } from "@/components/source-original-preview";
import { SourceUploadDialog } from "@/components/source-upload-dialog";
import { useChunksPanelWorkflow } from "@/components/chunks-panel-workflow";
import { ParsedChunkCard } from "@/components/parsed-chunk-card";
import { useSourceOriginalPreviewWarmup } from "@/components/source-original-preview-warmup";
import { sourceOriginalPreviewModel } from "@/components/source-original-preview-model";
import type { ParsedChunkView } from "@/domains/chunks/types";
import type { SourceOriginalFileView, SourceView } from "@/domains/sources/types";
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
  onLoginClick?: () => void;
  onSourceUploaded?: (source: SourceView) => void;
};

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
  onLoginClick,
  onSourceUploaded,
}: Partial<ChunksPanelProps> = {}) {
  const originalPreviewCacheKey = selectedSourceFile?.url ?? null;
  const isOriginalPreviewAvailable =
    sourceOriginalPreviewModel.canPreviewOriginalFile(
      selectedSource,
      selectedSourceFile,
    );
  const [mountedOriginalPreviewKey, setMountedOriginalPreviewKey] = useState<
    string | null
  >(null);
  const {
    activeFocusedChunkId,
    handleChunkSelected: selectChunk,
    handleOriginalViewSelected: selectOriginalView,
    handleParsedViewSelected,
    handleViewportScroll,
    hasOriginalFile,
    measureVirtualChunkElement,
    originalTargetPageNumber,
    originalTargetPageRequestId,
    requestChunkFocus,
    totalHeight,
    viewportRef,
    virtualItems,
    visibleChunks,
    visibleView,
  } = useChunksPanelWorkflow({
    chunks,
    selectedSource,
    selectedSourceFile,
    focusedChunkId,
    focusedChunkRequestId,
    hasMoreChunks,
    isLoading,
    isLoadingMore,
    onLoadMore,
  });
  useSourceOriginalPreviewWarmup({
    sourceTitle: selectedSource,
    file: selectedSourceFile,
  });

  const rememberOriginalPreview = useCallback((): void => {
    if (originalPreviewCacheKey) {
      setMountedOriginalPreviewKey(originalPreviewCacheKey);
    }
  }, [originalPreviewCacheKey]);

  const handleChunkSelected = useCallback(
    (chunk: ParsedChunkView): void => {
      rememberOriginalPreview();
      selectChunk(chunk);
    },
    [rememberOriginalPreview, selectChunk],
  );
  const handleOriginalViewSelected = useCallback((): void => {
    rememberOriginalPreview();
    selectOriginalView();
  }, [rememberOriginalPreview, selectOriginalView]);

  const headerTitle = focusedChunkId ? "Referenced Chunks" : "Parsed Chunks";
  const shouldMountOriginalPreview =
    visibleView === "original" ||
    (originalPreviewCacheKey !== null &&
      mountedOriginalPreviewKey === originalPreviewCacheKey);
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
              onClick={handleParsedViewSelected}
              className={viewToggleClassName(visibleView === "parsed")}
            >
              Parsed
            </button>
            <button
              type="button"
              onClick={handleOriginalViewSelected}
              className={viewToggleClassName(visibleView === "original")}
            >
              Original
            </button>
          </div>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1">
        <ViewPanel isActive={visibleView === "parsed"}>
          <ScrollArea
            className="h-full"
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
                selectedSource ? (
                  <EmptyChunks />
                ) : (
                  <EmptySourceUploadState
                    onLoginClick={onLoginClick}
                    onSourceUploaded={onSourceUploaded}
                  />
                )
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
                      isOriginalPreviewAvailable={isOriginalPreviewAvailable}
                      measureElement={measureVirtualChunkElement}
                      onChunkClick={
                        hasOriginalFile ? handleChunkSelected : undefined
                      }
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
        </ViewPanel>
        {shouldMountOriginalPreview ? (
          <ViewPanel isActive={visibleView === "original"}>
            <ScrollArea className="h-full" scrollbars="both">
              <SourceOriginalPreview
                sourceTitle={selectedSource ?? "Original file"}
                file={selectedSourceFile}
                targetPageNumber={originalTargetPageNumber}
                targetPageRequestId={originalTargetPageRequestId}
              />
            </ScrollArea>
          </ViewPanel>
        ) : null}
      </div>
    </main>
  );
}

function EmptySourceUploadState({
  onLoginClick,
  onSourceUploaded,
}: {
  readonly onLoginClick?: () => void;
  readonly onSourceUploaded?: (source: SourceView) => void;
}): ReactNode {
  if (onLoginClick) {
    return (
      <button
        type="button"
        onClick={onLoginClick}
        className={emptyUploadTargetClassName}
      >
        <EmptyUploadPicture />
        <span className="text-base font-semibold text-foreground">
          Log in to add documents
        </span>
        <span className="max-w-sm text-sm leading-6 text-muted-foreground">
          Add your first source to see parsed chunks and ask questions from this
          workspace.
        </span>
      </button>
    );
  }

  if (!onSourceUploaded) {
    return <EmptyChunks />;
  }

  return (
    <SourceUploadDialog
      onSourceUploaded={onSourceUploaded}
      renderTrigger={({ onClick, onDragOver, onDrop }) => (
        <button
          type="button"
          onClick={onClick}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={emptyUploadTargetClassName}
        >
          <EmptyUploadPicture />
          <span className="text-base font-semibold text-foreground">
            Upload a document
          </span>
          <span className="max-w-sm text-sm leading-6 text-muted-foreground">
            Click to choose a file, or drag a document here to prepare it for
            parsed chunks and chat.
          </span>
          <span className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
            PDF, DOCX, TXT, MD, spreadsheets, slides, and images up to 100 MB
          </span>
        </button>
      )}
    />
  );
}

function EmptyUploadPicture(): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="relative mb-2 flex h-36 w-44 items-center justify-center"
    >
      <span className="absolute bottom-3 left-4 h-24 w-20 rotate-[-8deg] rounded-lg border border-border bg-card shadow-sm" />
      <span className="absolute bottom-6 right-5 h-28 w-24 rotate-6 rounded-lg border border-border bg-card shadow-sm" />
      <span className="absolute flex size-20 items-center justify-center rounded-2xl border border-[#ddd6fe] border-l-[6px] bg-[#ede9fe] text-[#7f22fe] shadow-[0_16px_30px_-20px_rgba(127,34,254,0.8)] dark:border-[#6d28d9] dark:bg-[#3b0764] dark:text-[#ddd6fe]">
        <FilePlus2 className="size-9" strokeWidth={1.75} />
      </span>
      <span className="absolute bottom-0 flex h-10 items-center gap-2 rounded-lg border-x-2 border-t-2 border-b-[5px] border-[#e7e5e4] bg-white px-4 pb-0.5 font-mono-display text-xs font-semibold text-[#292524] dark:border-[#3f3f46] dark:bg-[#18181b] dark:text-[#fafafa]">
        <UploadCloud className="size-4" strokeWidth={1.75} />
        Drop files
      </span>
    </span>
  );
}

const emptyUploadTargetClassName =
  "mx-auto flex min-h-[440px] w-full max-w-2xl cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-background-secondary/70 px-6 py-10 text-center transition-colors hover:border-[#8e51ff]/60 hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8e51ff]/15 dark:bg-background-secondary/80";

function ViewPanel({
  children,
  isActive,
}: {
  readonly children: ReactNode;
  readonly isActive: boolean;
}): ReactNode {
  return (
    <section
      aria-hidden={isActive ? undefined : true}
      inert={isActive ? undefined : true}
      className={cn(
        "absolute inset-0 min-h-0 transition-opacity",
        isActive
          ? "z-10 opacity-100"
          : "z-0 pointer-events-none opacity-0",
      )}
    >
      {children}
    </section>
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
  isOriginalPreviewAvailable,
  measureElement,
  onChunkClick,
  onReferenceClick,
}: {
  virtualItem: VirtualItem;
  chunk: ParsedChunkView | undefined;
  focusedChunkId: string | null;
  isOriginalPreviewAvailable: boolean;
  measureElement: (node: HTMLDivElement | null) => void;
  onChunkClick?: (chunk: ParsedChunkView) => void;
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
        isOriginalPreviewAvailable={isOriginalPreviewAvailable}
        onChunkClick={onChunkClick}
        onReferenceClick={onReferenceClick}
      />
    </div>
  );
}
