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
import { FileText, ImageIcon, Layers, Table2, Tags, TextQuote } from "lucide-react";
import DOMPurify from "dompurify";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SourceOriginalPreview } from "@/components/source-original-preview";
import type {
  ParsedChunkConnection,
  ParsedChunkView,
  SourceOriginalFileView,
} from "@/lib/types";
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
    () => getChunksWithFocusedFirst(chunks, activeFocusedChunkId),
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

  const resetFocusedChunkPosition = useCallback((): void => {
    const viewport = viewportRef.current;

    if (viewport) {
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
    }

    chunkVirtualizer.scrollToOffset(0, {
      align: "start",
      behavior: "auto",
    });
  }, [chunkVirtualizer]);

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

    resetFocusedChunkPosition();

    const frameId = window.requestAnimationFrame(() => {
      resetFocusedChunkPosition();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeFocusedChunkId, focusedChunkRequestId, resetFocusedChunkPosition]);

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
            className="mx-auto flex w-full min-w-0 max-w-4xl flex-col items-center p-3 sm:p-6"
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

function getChunksWithFocusedFirst(
  chunks: readonly ParsedChunkView[],
  focusedChunkId: string | null,
): readonly ParsedChunkView[] {
  if (!focusedChunkId) {
    return chunks;
  }

  const focusedIndex = chunks.findIndex(
    (chunk) => chunk.chunkId === focusedChunkId,
  );
  if (focusedIndex <= 0) {
    return chunks;
  }

  const focusedChunk = chunks[focusedIndex]!;
  return [
    focusedChunk,
    ...chunks.slice(0, focusedIndex),
    ...chunks.slice(focusedIndex + 1),
  ];
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
      <ChunkCard
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

function ChunkCard({
  chunk,
  isFocused,
  onReferenceClick,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
  onReferenceClick: (chunkId: string) => void;
}): ReactNode {
  if (chunk.type === "image") {
    return (
      <div
        data-testid={`chunk-card-shell-${chunk.chunkId}`}
        className="w-full min-w-0"
      >
        <ImageChunkCard chunk={chunk} isFocused={isFocused} />
      </div>
    );
  }
  if (chunk.type === "table") {
    return (
      <div
        data-testid={`chunk-card-shell-${chunk.chunkId}`}
        className="w-full min-w-0"
      >
        <TableChunkCard chunk={chunk} isFocused={isFocused} />
      </div>
    );
  }
  return (
    <div
      data-testid={`chunk-card-shell-${chunk.chunkId}`}
      className="w-full min-w-0"
    >
      <TextChunkCard
        chunk={chunk}
        isFocused={isFocused}
        onReferenceClick={onReferenceClick}
      />
    </div>
  );
}

function ChunkCardFrame({
  chunk,
  isFocused,
  children,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <Card
      className={cn(
        "w-full min-w-0 cursor-default overflow-hidden rounded-lg shadow-xs transition-colors",
        focusCardClasses(isFocused),
      )}
    >
      <CardContent className="space-y-3 p-3 sm:p-4">
        <ChunkSourcePanel chunk={chunk} />
        {children}
      </CardContent>
    </Card>
  );
}

function ChunkSourcePanel({ chunk }: { chunk: ParsedChunkView }): ReactNode {
  const pageLabel = formatPageNumbers(chunk.pageNums);

  return (
    <section
      data-testid={`chunk-source-panel-${chunk.chunkId}`}
      className="rounded-lg border border-border/70 bg-background/80 p-3"
    >
      <div className="flex min-w-0 gap-3">
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg border shadow-inner",
            getChunkIconClasses(chunk.type),
          )}
        >
          {renderChunkIcon(chunk.type)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="h-5 rounded-md px-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
            >
              {getChunkTypeLabel(chunk.type)}
            </Badge>
            {pageLabel ? (
              <Badge
                variant="secondary"
                className="h-5 rounded-md px-1.5 text-[10px] font-semibold text-muted-foreground"
              >
                {pageLabel}
              </Badge>
            ) : null}
          </div>
          {chunk.sectionPath ? (
            <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
              {chunk.sectionPath}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ChunkSummaryPanel({ chunk }: { chunk: ParsedChunkView }): ReactNode {
  if (!chunk.summary) return null;

  return (
    <section
      data-testid={`chunk-summary-panel-${chunk.chunkId}`}
      className="rounded-lg border border-border/70 bg-muted/35 p-3"
    >
      <SectionLabel icon={<TextQuote className="size-3.5" />} label="Summary" />
      <p className="mt-2 text-sm leading-6 text-foreground/85">{chunk.summary}</p>
    </section>
  );
}

function ChunkContentPanel({
  chunk,
  children,
}: {
  chunk: ParsedChunkView;
  children: ReactNode;
}): ReactNode {
  return (
    <section
      data-testid={`chunk-content-panel-${chunk.chunkId}`}
      className="rounded-lg border border-border/70 bg-card p-3"
    >
      <SectionLabel icon={<FileText className="size-3.5" />} label="Content" />
      <div className="mt-2 min-w-0">{children}</div>
    </section>
  );
}

function ChunkKeywords({ chunk }: { chunk: ParsedChunkView }): ReactNode {
  if (!chunk.keywords || chunk.keywords.length === 0) return null;

  return (
    <section
      data-testid={`chunk-keywords-panel-${chunk.chunkId}`}
      className="rounded-lg border border-border/70 bg-background/70 p-3"
    >
      <SectionLabel icon={<Tags className="size-3.5" />} label="Keywords" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chunk.keywords.map((keyword) => (
          <Badge
            key={keyword}
            variant="secondary"
            className="rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {keyword}
          </Badge>
        ))}
      </div>
    </section>
  );
}

function SectionLabel({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}): ReactNode {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {label}
    </div>
  );
}

function focusCardClasses(isFocused: boolean): string {
  return isFocused
    ? "border-primary/70 bg-primary/5 ring-2 ring-primary/30 shadow-md"
    : "hover:border-primary/30";
}

function TextChunkCard({
  chunk,
  isFocused,
  onReferenceClick,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
  onReferenceClick: (chunkId: string) => void;
}): ReactNode {
  return (
    <ChunkCardFrame chunk={chunk} isFocused={isFocused}>
      <ChunkSummaryPanel chunk={chunk} />
      <ChunkContentPanel chunk={chunk}>
        <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-foreground sm:text-sm">
          {renderTextChunkContent(chunk, onReferenceClick)}
        </pre>
      </ChunkContentPanel>
      <ChunkKeywords chunk={chunk} />
    </ChunkCardFrame>
  );
}

function ImageChunkCard({
  chunk,
  isFocused,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
}): ReactNode {
  return (
    <ChunkCardFrame chunk={chunk} isFocused={isFocused}>
      <ChunkSummaryPanel chunk={chunk} />
      <ChunkContentPanel chunk={chunk}>
        {chunk.assetUrl ? (
          <figure className="overflow-hidden rounded-lg border border-border bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element -- Parsed artifact dimensions are not known before render. */}
            <img
              src={chunk.assetUrl}
              alt={chunk.summary ?? "Image chunk"}
              className="max-h-[520px] w-full object-contain"
            />
          </figure>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/40 py-8 text-center">
            <ImageIcon className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Image chunk
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {chunk.summary ?? "Image content is not available in this view."}
              </p>
            </div>
          </div>
        )}
      </ChunkContentPanel>
      <ChunkKeywords chunk={chunk} />
    </ChunkCardFrame>
  );
}

function renderTextChunkContent(
  chunk: ParsedChunkView,
  onReferenceClick: (chunkId: string) => void,
): ReactNode {
  const references = getRenderableReferences(chunk);
  if (references.length === 0) return chunk.content;

  const nodes: ReactNode[] = [];
  let cursor = 0;

  references.forEach((reference, index) => {
    if (reference.start > cursor) {
      nodes.push(chunk.content.slice(cursor, reference.start));
    }
    nodes.push(
      <ChunkReferenceButton
        key={`${reference.connection.ref ?? "ref"}-${index}`}
        connection={reference.connection}
        onReferenceClick={onReferenceClick}
      />,
    );
    cursor = reference.end;
  });

  if (cursor < chunk.content.length) {
    nodes.push(chunk.content.slice(cursor));
  }

  return nodes;
}

type RenderableReference = {
  start: number;
  end: number;
  connection: ParsedChunkConnection;
};

function getRenderableReferences(
  chunk: ParsedChunkView,
): RenderableReference[] {
  if (!chunk.connections || chunk.connections.length === 0) return [];

  const references = chunk.connections.flatMap(
    (connection): RenderableReference[] => {
      const range = getReferenceRange(chunk.content, connection);
      return range ? [{ ...range, connection }] : [];
    },
  );

  const sorted = references.sort((a, b) => a.start - b.start);
  const nonOverlapping: RenderableReference[] = [];
  let previousEnd = -1;

  sorted.forEach((reference) => {
    if (reference.start < previousEnd) return;
    nonOverlapping.push(reference);
    previousEnd = reference.end;
  });

  return nonOverlapping;
}

function getReferenceRange(
  content: string,
  connection: ParsedChunkConnection,
): { start: number; end: number } | null {
  const positioned = connection.position;
  if (
    positioned &&
    positioned.start >= 0 &&
    positioned.end > positioned.start &&
    positioned.end <= content.length
  ) {
    return positioned;
  }

  if (!connection.ref) return null;
  const start = content.indexOf(connection.ref);
  if (start < 0) return null;
  return { start, end: start + connection.ref.length };
}

function ChunkReferenceButton({
  connection,
  onReferenceClick,
}: {
  connection: ParsedChunkConnection;
  onReferenceClick: (chunkId: string) => void;
}): ReactNode {
  const isResolved = typeof connection.targetChunkId === "string";
  const label = getReferenceLabel(connection);

  return (
    <button
      type="button"
      disabled={!isResolved}
      aria-disabled={!isResolved}
      className="mx-0.5 inline-flex max-w-full items-center rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[12px] font-medium leading-5 text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
      onClick={() => {
        if (connection.targetChunkId) onReferenceClick(connection.targetChunkId);
      }}
    >
      {label}
    </button>
  );
}

function getReferenceLabel(connection: ParsedChunkConnection): string {
  const ref = connection.ref?.trim();
  if (!ref) return connection.targetParserChunkId;
  return formatReferenceLabel(ref);
}

function formatReferenceLabel(ref: string): string {
  const cleanedReference = ref.replace(/^\[/, "").replace(/\]$/, "").trim();
  const pathWithoutQuery = cleanedReference.split(/[?#]/, 1)[0] ?? cleanedReference;
  const fileName = pathWithoutQuery.split(/[\\/]/).filter(Boolean).at(-1);
  const baseName = fileName ?? pathWithoutQuery;
  const withoutExtension = baseName.replace(
    /\.(?:csv|gif|htm|html|jpeg|jpg|md|pdf|png|svg|txt|webp)$/i,
    "",
  );

  const readableName = withoutExtension
    .replace(/_/g, " ")
    .replace(/-/g, getReadableDashReplacement)
    .replace(/^(image|table)\s+(\d+)/i, (_, type: string, index: string) =>
      `${capitalize(type)} ${index}`,
    );

  return capitalize(readableName.replace(/\s+/g, " ").trim());
}

function getReadableDashReplacement(
  _match: string,
  index: number,
  value: string,
): string {
  const previous = value.at(index - 1) ?? "";
  const next = value.at(index + 1) ?? "";
  return /\d/.test(previous) && /\d/.test(next) ? "-" : " ";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function TableChunkCard({
  chunk,
  isFocused,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
}): ReactNode {
  const hasHtml = chunk.content.trim().startsWith("<");

  const safeHtml = useMemo(
    () =>
      hasHtml
        ? DOMPurify.sanitize(chunk.content, {
            ALLOWED_TAGS: [
              "table",
              "thead",
              "tbody",
              "tfoot",
              "tr",
              "th",
              "td",
              "caption",
              "colgroup",
              "col",
            ],
            ALLOWED_ATTR: ["colspan", "rowspan", "scope", "align"],
          })
        : null,
    [chunk.content, hasHtml],
  );

  return (
    <ChunkCardFrame chunk={chunk} isFocused={isFocused}>
      <ChunkSummaryPanel chunk={chunk} />
      <ChunkContentPanel chunk={chunk}>
        {safeHtml ? (
          <div
            data-testid={`chunk-table-content-${chunk.chunkId}`}
            className="prose prose-sm max-w-full overflow-x-auto text-sm leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/40 py-8 text-center">
            <Table2 className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Table chunk
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {chunk.summary ?? "Table content is not available in this view."}
              </p>
            </div>
          </div>
        )}
      </ChunkContentPanel>
      <ChunkKeywords chunk={chunk} />
    </ChunkCardFrame>
  );
}

function renderChunkIcon(type: ParsedChunkView["type"]): ReactNode {
  if (type === "image") return <ImageIcon className="size-4" />;
  if (type === "table") return <Table2 className="size-4" />;
  return <FileText className="size-4" />;
}

function getChunkIconClasses(type: ParsedChunkView["type"]): string {
  if (type === "image") {
    return "border-violet-500/15 bg-violet-500/10 text-violet-600 dark:text-violet-300";
  }
  if (type === "table") {
    return "border-primary/15 bg-primary/10 text-primary";
  }
  return "border-border bg-muted/60 text-muted-foreground";
}

function getChunkTypeLabel(type: ParsedChunkView["type"]): string {
  if (type === "image") return "Image";
  if (type === "table") return "Table";
  return "Text";
}

function formatPageNumbers(pageNums: ParsedChunkView["pageNums"]): string | null {
  if (!pageNums || pageNums.length === 0) return null;

  const uniquePageNums = Array.from(new Set(pageNums)).sort(
    (leftPageNum, rightPageNum) => leftPageNum - rightPageNum,
  );
  if (uniquePageNums.length === 1) return `Page ${uniquePageNums[0]}`;

  const visiblePageNums = uniquePageNums.slice(0, 3).join(", ");
  const suffix = uniquePageNums.length > 3 ? "..." : "";
  return `Pages ${visiblePageNums}${suffix}`;
}
