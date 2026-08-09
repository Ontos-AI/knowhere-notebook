"use client";

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type VirtualItem } from "@tanstack/react-virtual";
import {
  hierarchy,
  tree as createD3Tree,
  type HierarchyPointLink,
  type HierarchyPointNode,
} from "d3-hierarchy";
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Layers,
  RotateCcw,
  UploadCloud,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SourceOriginalPreview } from "@/components/source-original-preview";
import { SourceUploadDialog } from "@/components/source-upload-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChunksPanelWorkflow } from "@/components/chunks-panel-workflow";
import { ParsedChunkCard } from "@/components/parsed-chunk-card";
import { chunksPanelState } from "@/components/chunks-panel-state";
import { MAX_UPLOAD_MB } from "@/domains/sources/validation";
import { useSourceOriginalPreviewWarmup } from "@/components/source-original-preview-warmup";
import { sourceOriginalPreviewModel } from "@/components/source-original-preview-model";
import type { ParsedChunkView } from "@/domains/chunks/types";
import type { SourceOriginalFileView, SourceView } from "@/domains/sources/types";
import type { AnalyticsContext } from "@/lib/posthog";
import { cn } from "@/lib/utils";

export type ChunksPanelProps = {
  chunks: ParsedChunkView[];
  selectedSource?: string | null;
  selectedSourceFile?: SourceOriginalFileView | null;
  focusedChunkId?: string | null;
  focusedChunkRequestId?: number;
  citationListViewRequestId?: number;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  isLoadingAllChunks?: boolean;
  hasMoreChunks?: boolean;
  onLoadMore?: () => void;
  onLoadAllChunks?: () => void;
  onClose?: () => void;
  onClearFocus?: () => void;
  onLoginClick?: () => void;
  onSourceUploaded?: (source: SourceView) => void;
  analyticsContext?: AnalyticsContext;
  sourceCountSnapshot?: number;
};

type ChunkDisplayMode = "list" | "tree";

type ChunkDisplayModeState = {
  readonly handledCitationListViewRequestId: number;
  readonly handledFocusedChunkRequestId: number;
  readonly mode: ChunkDisplayMode;
};

export function ChunksPanel({
  chunks = [],
  selectedSource = null,
  selectedSourceFile = null,
  focusedChunkId = null,
  focusedChunkRequestId = 0,
  citationListViewRequestId = 0,
  isLoading = false,
  isLoadingMore = false,
  isLoadingAllChunks = false,
  hasMoreChunks = false,
  onLoadMore,
  onLoadAllChunks,
  onClose,
  onClearFocus,
  onLoginClick,
  onSourceUploaded,
  analyticsContext,
  sourceCountSnapshot = 0,
}: Partial<ChunksPanelProps> = {}) {
  const isOriginalPreviewAvailable =
    sourceOriginalPreviewModel.canPreviewOriginalFile(
      selectedSource,
      selectedSourceFile,
    );
  const [chunkDisplayModeState, setChunkDisplayModeState] =
    useState<ChunkDisplayModeState>(() => ({
      handledCitationListViewRequestId: citationListViewRequestId,
      handledFocusedChunkRequestId:
        focusedChunkId === null ? focusedChunkRequestId : -1,
      mode: "tree",
    }));
  const [sectionTreeZoomPercent, setSectionTreeZoomPercent] =
    useState<number>(sectionTreeDefaultZoomPercent);
  const {
    activeFocusedChunkId,
    handleChunkSelected: selectChunk,
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

  const handleChunkSelected = useCallback(
    (chunk: ParsedChunkView): void => {
      selectChunk(chunk);
    },
    [selectChunk],
  );
  const handleListModeSelected = useCallback((): void => {
    setChunkDisplayModeState({
      handledCitationListViewRequestId: citationListViewRequestId,
      handledFocusedChunkRequestId: focusedChunkRequestId,
      mode: "list",
    });
  }, [citationListViewRequestId, focusedChunkRequestId]);
  const handleTreeModeSelected = useCallback((): void => {
    setChunkDisplayModeState({
      handledCitationListViewRequestId: citationListViewRequestId,
      handledFocusedChunkRequestId: focusedChunkRequestId,
      mode: "tree",
    });
  }, [citationListViewRequestId, focusedChunkRequestId]);
  const handleTreeChunkFocus = useCallback(
    (chunkId: string | null): void => {
      requestChunkFocus(chunkId);
      if (chunkId !== null) {
        setChunkDisplayModeState({
          handledCitationListViewRequestId: citationListViewRequestId,
          handledFocusedChunkRequestId: focusedChunkRequestId,
          mode: "list",
        });
      }
    },
    [citationListViewRequestId, focusedChunkRequestId, requestChunkFocus],
  );
  const canZoomSectionTreeOut: boolean =
    sectionTreeZoomPercent > sectionTreeMinimumZoomPercent;
  const canZoomSectionTreeIn: boolean =
    sectionTreeZoomPercent < sectionTreeMaximumZoomPercent;
  const canResetSectionTreeZoom: boolean =
    sectionTreeZoomPercent !== sectionTreeDefaultZoomPercent;
  const handleSectionTreeZoomOut = useCallback((): void => {
    setSectionTreeZoomPercent((currentZoomPercent) =>
      Math.max(
        sectionTreeMinimumZoomPercent,
        currentZoomPercent - sectionTreeZoomStepPercent,
      ),
    );
  }, []);
  const handleSectionTreeZoomIn = useCallback((): void => {
    setSectionTreeZoomPercent((currentZoomPercent) =>
      Math.min(
        sectionTreeMaximumZoomPercent,
        currentZoomPercent + sectionTreeZoomStepPercent,
      ),
    );
  }, []);
  const handleSectionTreeZoomReset = useCallback((): void => {
    setSectionTreeZoomPercent(sectionTreeDefaultZoomPercent);
  }, []);
  const handleSectionTreeWheelZoom = useCallback(
    (direction: SectionTreeZoomDirection): void => {
      setSectionTreeZoomPercent((currentZoomPercent) => {
        if (direction === "in") {
          return Math.min(
            sectionTreeMaximumZoomPercent,
            currentZoomPercent + sectionTreeZoomStepPercent,
          );
        }

        return Math.max(
          sectionTreeMinimumZoomPercent,
          currentZoomPercent - sectionTreeZoomStepPercent,
        );
      });
    },
    [],
  );
  const chunkDisplayMode: ChunkDisplayMode =
    (focusedChunkId !== null &&
      chunkDisplayModeState.handledFocusedChunkRequestId !==
        focusedChunkRequestId) ||
    chunkDisplayModeState.handledCitationListViewRequestId !==
      citationListViewRequestId
      ? "list"
      : chunkDisplayModeState.mode;
  const headerTitle = focusedChunkId ? "Referenced Chunks" : "Parsed Chunks";
  const shouldMountOriginalPreview = visibleView === "original";
  const isTreeModeVisible =
    visibleView === "parsed" && chunkDisplayMode === "tree";
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
    if (
      chunkDisplayMode !== "tree" ||
      visibleView !== "parsed" ||
      !hasMoreChunks ||
      isLoadingAllChunks
    ) {
      return;
    }

    onLoadAllChunks?.();
  }, [
    chunkDisplayMode,
    hasMoreChunks,
    isLoadingAllChunks,
    onLoadAllChunks,
    selectedSource,
    visibleView,
  ]);

  return (
    <main
      data-testid="chunks-panel"
      className="z-0 flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-border/70 px-4 py-3 sm:px-6 sm:py-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">
            {visibleView === "original" ? "Original File" : headerTitle}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground sm:truncate">
            {headerSubtitle}
          </p>
        </div>
        <div className="flex min-w-0 shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {visibleView === "parsed" && chunks.length > 0 ? (
            <>
              {activeFocusedChunkId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="show-all-chunks-button"
                  onClick={() => {
                    requestChunkFocus(null);
                    onClearFocus?.();
                  }}
                  className="shrink-0"
                >
                  Show all chunks
                </Button>
              ) : null}
              <div
                role="group"
                aria-label="Chunk display"
                className="flex shrink-0 rounded-lg border border-border bg-muted/40 p-0.5"
              >
                <button
                  type="button"
                  onClick={handleListModeSelected}
                  className={viewToggleClassName(chunkDisplayMode === "list")}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={handleTreeModeSelected}
                  className={viewToggleClassName(chunkDisplayMode === "tree")}
                >
                  Tree
                </button>
              </div>
            </>
          ) : null}
          {onClose ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="shrink-0"
            >
              Close
            </Button>
          ) : null}
        </div>
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
                    analyticsContext={analyticsContext}
                    sourceCountSnapshot={sourceCountSnapshot}
                  />
                )
              ) : isTreeModeVisible ? (
                <ChunkSectionTree
                  key={selectedSource ?? "parsed-chunks"}
                  chunks={chunks}
                  focusedChunkId={activeFocusedChunkId}
                  isLoadingAllChunks={isLoadingAllChunks}
                  sourceTitle={selectedSource ?? "Parsed Chunks"}
                  zoomPercent={sectionTreeZoomPercent}
                  onChunkFocus={handleTreeChunkFocus}
                  onWheelZoom={handleSectionTreeWheelZoom}
                />
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
                      selectedSourceFile={selectedSourceFile}
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
          {isTreeModeVisible ? (
            <div
              data-testid="chunk-section-tree-zoom-overlay"
              className="pointer-events-none absolute left-3 top-3 z-20 sm:left-6 sm:top-6"
            >
              <div className="pointer-events-auto">
                <SectionTreeZoomControls
                  canResetZoom={canResetSectionTreeZoom}
                  canZoomIn={canZoomSectionTreeIn}
                  canZoomOut={canZoomSectionTreeOut}
                  zoomPercent={sectionTreeZoomPercent}
                  onZoomIn={handleSectionTreeZoomIn}
                  onZoomOut={handleSectionTreeZoomOut}
                  onZoomReset={handleSectionTreeZoomReset}
                />
              </div>
            </div>
          ) : null}
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

type ChunkSectionTreeNode = ReturnType<typeof chunksPanelState.buildSectionTree>;

type RenderableChunkTreeNodeKind = "root" | "section" | "chunk";

type RenderableChunkTreeNode = {
  readonly id: string;
  readonly kind: RenderableChunkTreeNodeKind;
  readonly label: string;
  readonly chunkCount: number;
  readonly chunk?: ParsedChunkView;
  readonly children: readonly RenderableChunkTreeNode[];
};

type ChunkSectionTreeLayout = {
  readonly height: number;
  readonly links: readonly HierarchyPointLink<RenderableChunkTreeNode>[];
  readonly nodes: readonly HierarchyPointNode<RenderableChunkTreeNode>[];
  readonly width: number;
  readonly xOffset: number;
  readonly yOffset: number;
};

type SectionTreeZoomDirection = "in" | "out";

type SectionTreePan = {
  readonly x: number;
  readonly y: number;
};

type SectionTreeDragState = {
  readonly panStartX: number;
  readonly panStartY: number;
  readonly pointerStartX: number;
  readonly pointerStartY: number;
};

const sectionTreeNodeWidth = 208;
const sectionTreeNodeHeight = 58;
const sectionTreeColumnGap = 254;
const sectionTreeRowGap = 78;
const sectionTreeMinimumWidth = 720;
const sectionTreeMinimumHeight = 260;
const sectionTreeCardHorizontalPadding = 32;
const sectionTreeDefaultZoomPercent = 100;
const sectionTreeMinimumZoomPercent = 30;
const sectionTreeMaximumZoomPercent = 140;
const sectionTreeZoomStepPercent = 10;
const initialSectionTreePan: SectionTreePan = {
  x: 0,
  y: 0,
};
const sectionTreePadding = {
  top: 38,
  right: 42,
  bottom: 38,
  left: 24,
} as const;

function ChunkSectionTree({
  chunks,
  focusedChunkId,
  isLoadingAllChunks,
  sourceTitle,
  zoomPercent,
  onChunkFocus,
  onWheelZoom,
}: {
  readonly chunks: readonly ParsedChunkView[];
  readonly focusedChunkId: string | null;
  readonly isLoadingAllChunks: boolean;
  readonly sourceTitle: string;
  readonly zoomPercent: number;
  readonly onChunkFocus: (chunkId: string | null) => void;
  readonly onWheelZoom: (direction: SectionTreeZoomDirection) => void;
}): ReactNode {
  const [sectionTreePan, setSectionTreePan] =
    useState<SectionTreePan>(initialSectionTreePan);
  const [sectionTreeDragState, setSectionTreeDragState] =
    useState<SectionTreeDragState | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const sectionTreeZoomSurfaceRef = useRef<HTMLDivElement | null>(null);
  const sectionTree = useMemo(
    () => chunksPanelState.buildSectionTree(chunks, sourceTitle),
    [chunks, sourceTitle],
  );
  const isNodeExpanded = useCallback(
    (node: RenderableChunkTreeNode): boolean =>
      node.kind === "root" || expandedNodeIds.has(node.id),
    [expandedNodeIds],
  );
  const handleNodeToggle = useCallback((nodeId: string): void => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);
  const layout = useMemo(
    () => getChunkSectionTreeLayout(sectionTree, isNodeExpanded),
    [sectionTree, isNodeExpanded],
  );
  const scaledLayoutWidth: number = Math.round(
    (layout.width * zoomPercent) / 100,
  );
  const scaledLayoutHeight: number = Math.round(
    (layout.height * zoomPercent) / 100,
  );
  const zoomScale: string = formatSectionTreeZoomScale(zoomPercent);
  const handlePanStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      if (event.button !== 0 || isInteractiveSectionTreeTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setSectionTreeDragState({
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        panStartX: sectionTreePan.x,
        panStartY: sectionTreePan.y,
      });
    },
    [sectionTreePan.x, sectionTreePan.y],
  );

  useEffect(() => {
    const zoomSurface = sectionTreeZoomSurfaceRef.current;
    if (!zoomSurface) return;

    const handleWheelZoom = (event: WheelEvent): void => {
      // Only zoom on Ctrl/Cmd+wheel (trackpad pinch sends ctrl+wheel). Plain
      // wheel events pass through to the enclosing ScrollArea so expanding a
      // section past the pane height scrolls normally instead of zooming.
      if (!event.ctrlKey && !event.metaKey) return;

      if (event.deltaY === 0) return;

      event.preventDefault();
      onWheelZoom(event.deltaY < 0 ? "in" : "out");
    };

    zoomSurface.addEventListener("wheel", handleWheelZoom, {
      passive: false,
    });

    return () => {
      zoomSurface.removeEventListener("wheel", handleWheelZoom);
    };
  }, [onWheelZoom]);

  useEffect(() => {
    if (!sectionTreeDragState) return;

    const handlePanMove = (event: MouseEvent): void => {
      setSectionTreePan({
        x:
          sectionTreeDragState.panStartX +
          event.clientX -
          sectionTreeDragState.pointerStartX,
        y:
          sectionTreeDragState.panStartY +
          event.clientY -
          sectionTreeDragState.pointerStartY,
      });
    };
    const handlePanEnd = (): void => {
      setSectionTreeDragState(null);
    };

    window.addEventListener("mousemove", handlePanMove);
    window.addEventListener("mouseup", handlePanEnd);

    return () => {
      window.removeEventListener("mousemove", handlePanMove);
      window.removeEventListener("mouseup", handlePanEnd);
    };
  }, [sectionTreeDragState]);

  return (
    <div
      className="w-full min-w-0 rounded-lg border border-border bg-card p-3 shadow-xs sm:p-4"
      style={{
        minWidth: scaledLayoutWidth + sectionTreeCardHorizontalPadding,
      }}
    >
      {isLoadingAllChunks ? (
        <div className="mb-3 min-w-0 rounded-md border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
          Loading complete section tree...
        </div>
      ) : null}
      <div
        ref={sectionTreeZoomSurfaceRef}
        data-testid="chunk-section-tree-zoom-surface"
        className={cn(
          "relative cursor-grab overflow-hidden select-none",
          sectionTreeDragState ? "cursor-grabbing" : null,
        )}
        onMouseDown={handlePanStart}
        style={{
          height: scaledLayoutHeight,
          minWidth: scaledLayoutWidth,
          width: "100%",
        }}
      >
        <div
          role="tree"
          aria-label="Parsed chunk sections"
          className="relative overflow-visible"
          style={{
            height: layout.height,
            left: sectionTreePan.x,
            transform: `scale(${zoomScale})`,
            transformOrigin: "top left",
            top: sectionTreePan.y,
            width: layout.width,
          }}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            height={layout.height}
            width={layout.width}
          >
            <g fill="none" stroke="currentColor" className="text-border">
              {layout.links.map((link) => (
                <path
                  key={`${link.source.data.id}->${link.target.data.id}`}
                  d={getSectionTreeLinkPath(link, layout)}
                  strokeWidth={1.5}
                />
              ))}
            </g>
          </svg>
          {layout.nodes.map((node) => (
            <SectionTreeItem
              key={node.data.id}
              focusedChunkId={focusedChunkId}
              node={node}
              xOffset={layout.xOffset}
              yOffset={layout.yOffset}
              onChunkFocus={onChunkFocus}
              onNodeToggle={handleNodeToggle}
              isExpanded={isNodeExpanded(node.data)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionTreeZoomControls({
  canResetZoom,
  canZoomIn,
  canZoomOut,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: {
  readonly canResetZoom: boolean;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  readonly zoomPercent: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomReset: () => void;
}): ReactNode {
  return (
    <TooltipProvider>
      <div
        role="group"
        aria-label="Section tree zoom"
        className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-muted/35 p-1"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom out section tree"
              disabled={!canZoomOut}
              className="size-8 rounded-md text-muted-foreground hover:text-foreground"
              onClick={onZoomOut}
            >
              <ZoomOut className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>
        <span className="min-w-11 text-center text-xs font-semibold tabular-nums text-muted-foreground">
          {zoomPercent}%
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom in section tree"
              disabled={!canZoomIn}
              className="size-8 rounded-md text-muted-foreground hover:text-foreground"
              onClick={onZoomIn}
            >
              <ZoomIn className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Reset section tree zoom"
              disabled={!canResetZoom}
              className="size-8 rounded-md text-muted-foreground hover:text-foreground"
              onClick={onZoomReset}
            >
              <RotateCcw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset zoom</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

function SectionTreeItem({
  focusedChunkId,
  node,
  xOffset,
  yOffset,
  onChunkFocus,
  onNodeToggle,
  isExpanded,
}: {
  readonly focusedChunkId: string | null;
  readonly node: HierarchyPointNode<RenderableChunkTreeNode>;
  readonly xOffset: number;
  readonly yOffset: number;
  readonly onChunkFocus: (chunkId: string | null) => void;
  readonly onNodeToggle: (nodeId: string) => void;
  readonly isExpanded: boolean;
}): ReactNode {
  const itemStyle: CSSProperties = {
    left: node.y + yOffset,
    position: "absolute",
    top: node.x + xOffset - sectionTreeNodeHeight / 2,
    width: sectionTreeNodeWidth,
  };
  const isFocusedChunk =
    node.data.kind === "chunk" && node.data.chunk?.chunkId === focusedChunkId;
  const hasChildren = node.data.children.length > 0;
  const isToggleable =
    node.data.kind === "section" && hasChildren;

  return (
    <div
      role="treeitem"
      aria-label={getTreeItemAriaLabel(node.data)}
      aria-expanded={isToggleable ? isExpanded : undefined}
      aria-level={node.depth + 1}
      aria-selected={isFocusedChunk ? true : undefined}
      className="min-w-0"
      style={itemStyle}
    >
      {node.data.kind === "chunk" && node.data.chunk ? (
        <button
          type="button"
          className={cn(
            "flex h-[58px] w-full min-w-0 cursor-pointer flex-col justify-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-left text-violet-950 shadow-xs transition-colors hover:border-violet-400 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 dark:border-violet-800/70 dark:bg-violet-950/35 dark:text-violet-50 dark:hover:border-violet-500/80 dark:hover:bg-violet-900/50",
            isFocusedChunk
              ? "border-violet-500 bg-violet-100 dark:border-violet-400 dark:bg-violet-900/60"
              : null,
          )}
          onClick={() => onChunkFocus(node.data.chunk!.chunkId)}
        >
          <span className="truncate text-xs font-semibold text-violet-950 dark:text-violet-50">
            {node.data.label}
          </span>
          <span className="mt-1 truncate text-[11px] text-violet-700 dark:text-violet-200">
            {getChunkTreeDetail(node.data.chunk)}
          </span>
        </button>
      ) : (
        <div
          className={cn(
            "flex h-[58px] min-w-0 flex-col justify-center rounded-lg border px-3 shadow-xs",
            node.data.kind === "root"
              ? "border-primary/25 bg-primary/10"
              : "border-border bg-background-secondary",
            isToggleable ? "cursor-pointer transition-colors hover:border-primary/30 hover:bg-accent/40" : null,
          )}
          onClick={
            isToggleable ? () => onNodeToggle(node.data.id) : undefined
          }
        >
          <span className="flex items-center gap-1 truncate text-xs font-bold text-foreground">
            {isToggleable ? (
              isExpanded ? (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              )
            ) : null}
            {node.data.label}
          </span>
          <span className="mt-1 text-[11px] font-medium text-muted-foreground">
            {formatChunkCount(node.data.chunkCount)}
          </span>
        </div>
      )}
    </div>
  );
}

function isInteractiveSectionTreeTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("a,button,input,select,textarea,[role='button']") !== null
  );
}

function getChunkSectionTreeLayout(
  sectionTree: ChunkSectionTreeNode,
  isExpanded: (node: RenderableChunkTreeNode) => boolean,
): ChunkSectionTreeLayout {
  const renderableTree = toRenderableChunkTreeNode(sectionTree);
  const root = hierarchy<RenderableChunkTreeNode>(
    renderableTree,
    (node) =>
      node.children.length > 0 && isExpanded(node)
        ? [...node.children]
        : undefined,
  );
  const positionedRoot = createD3Tree<RenderableChunkTreeNode>()
    .nodeSize([sectionTreeRowGap, sectionTreeColumnGap])(root);
  const nodes = positionedRoot.descendants();
  const links = positionedRoot.links();
  const xPositions = nodes.map((node) => node.x);
  const yPositions = nodes.map((node) => node.y);
  const minX = Math.min(...xPositions);
  const maxX = Math.max(...xPositions);
  const maxY = Math.max(...yPositions);
  const width = Math.max(
    sectionTreeMinimumWidth,
    maxY +
      sectionTreePadding.left +
      sectionTreeNodeWidth +
      sectionTreePadding.right,
  );
  const height = Math.max(
    sectionTreeMinimumHeight,
    maxX - minX + sectionTreePadding.top + sectionTreePadding.bottom,
  );

  return {
    height,
    links,
    nodes,
    width,
    xOffset: sectionTreePadding.top - minX,
    yOffset: sectionTreePadding.left,
  };
}

function formatSectionTreeZoomScale(zoomPercent: number): string {
  return (zoomPercent / 100).toFixed(2).replace(/\.?0+$/, "");
}

function toRenderableChunkTreeNode(
  node: ChunkSectionTreeNode,
): RenderableChunkTreeNode {
  const sectionChildren = node.children.map(toRenderableChunkTreeNode);
  const chunkChildren = node.chunks.map((chunk): RenderableChunkTreeNode => ({
    id: `${node.id}/chunk/${chunk.chunkId}`,
    kind: "chunk",
    label: getChunkTreeLabel(chunk),
    chunk,
    chunkCount: 1,
    children: [],
  }));

  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    chunkCount: node.chunkCount,
    children: [...sectionChildren, ...chunkChildren],
  };
}

function getSectionTreeLinkPath(
  link: HierarchyPointLink<RenderableChunkTreeNode>,
  layout: ChunkSectionTreeLayout,
): string {
  const sourceX = link.source.x + layout.xOffset;
  const sourceY = link.source.y + layout.yOffset + sectionTreeNodeWidth;
  const targetX = link.target.x + layout.xOffset;
  const targetY = link.target.y + layout.yOffset;
  const middleY = (sourceY + targetY) / 2;

  return [
    `M${sourceY},${sourceX}`,
    `C${middleY},${sourceX}`,
    `${middleY},${targetX}`,
    `${targetY},${targetX}`,
  ].join(" ");
}

function getTreeItemAriaLabel(node: RenderableChunkTreeNode): string {
  if (node.kind === "chunk") {
    return `${node.label} ${getChunkTreeDetail(node.chunk!)}`;
  }
  return `${node.label} section with ${formatChunkCount(node.chunkCount)}`;
}

function getChunkTreeLabel(chunk: ParsedChunkView): string {
  if (chunk.filePath) {
    return chunksPanelState.formatReferenceLabel(`[${chunk.filePath}]`);
  }

  const summary = chunk.summary?.split(/\r?\n/, 1)[0]?.trim();
  if (summary) return truncateTreeLabel(summary);

  const content = (chunk.readableContent ?? chunk.content).replace(/\s+/g, " ").trim();
  if (content) return truncateTreeLabel(content);

  return `${getChunkTypeLabel(chunk.type)} chunk`;
}

function getChunkTreeDetail(chunk: ParsedChunkView): string {
  const pageLabel = getChunkPageLabel(chunk);
  return pageLabel
    ? `${getChunkTypeLabel(chunk.type)} · ${pageLabel}`
    : getChunkTypeLabel(chunk.type);
}

function getChunkPageLabel(chunk: ParsedChunkView): string | null {
  const pageNumbers = chunk.pageNums ?? [];
  const validPageNumbers = Array.from(
    new Set(
      pageNumbers.filter(
        (pageNumber) => Number.isFinite(pageNumber) && pageNumber > 0,
      ),
    ),
  ).sort((leftPageNumber, rightPageNumber) => leftPageNumber - rightPageNumber);
  if (validPageNumbers.length === 0) return null;
  if (validPageNumbers.length === 1) return `Page ${validPageNumbers[0]}`;

  const ranges: string[] = [];
  let rangeStart = validPageNumbers[0]!;
  let previousPageNumber = rangeStart;
  validPageNumbers.slice(1).forEach((pageNumber) => {
    if (pageNumber === previousPageNumber + 1) {
      previousPageNumber = pageNumber;
      return;
    }
    ranges.push(
      rangeStart === previousPageNumber
        ? String(rangeStart)
        : `${rangeStart}-${previousPageNumber}`,
    );
    rangeStart = pageNumber;
    previousPageNumber = pageNumber;
  });
  ranges.push(
    rangeStart === previousPageNumber
      ? String(rangeStart)
      : `${rangeStart}-${previousPageNumber}`,
  );

  return `Pages ${ranges.join(", ")}`;
}

function getChunkTypeLabel(type: ParsedChunkView["type"]): string {
  if (type === "page") return "Page";
  if (type === "image") return "Image";
  if (type === "table") return "Table";
  return "Text";
}

function formatChunkCount(chunkCount: number): string {
  return `${chunkCount} ${chunkCount === 1 ? "chunk" : "chunks"}`;
}

function truncateTreeLabel(value: string): string {
  const maxLength = 42;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function EmptySourceUploadState({
  analyticsContext,
  onLoginClick,
  onSourceUploaded,
  sourceCountSnapshot = 0,
}: {
  readonly analyticsContext?: AnalyticsContext;
  readonly onLoginClick?: () => void;
  readonly onSourceUploaded?: (source: SourceView) => void;
  readonly sourceCountSnapshot?: number;
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
      analyticsContext={analyticsContext}
      sourceCountSnapshot={sourceCountSnapshot}
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
            PDF, DOCX, TXT, MD, spreadsheets, slides, and images up to{" "}
            {MAX_UPLOAD_MB} MB
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
  selectedSourceFile,
}: {
  virtualItem: VirtualItem;
  chunk: ParsedChunkView | undefined;
  focusedChunkId: string | null;
  isOriginalPreviewAvailable: boolean;
  measureElement: (node: HTMLDivElement | null) => void;
  onChunkClick?: (chunk: ParsedChunkView) => void;
  onReferenceClick: (chunkId: string) => void;
  selectedSourceFile: SourceOriginalFileView | null;
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
        sourceOriginalFile={selectedSourceFile}
      />
    </div>
  );
}
