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
import { ImageIcon, Layers, Table2 } from "lucide-react";
import DOMPurify from "dompurify";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ParsedChunkConnection, ParsedChunkView } from "@/lib/types";
import {
  getItemOffset,
  getVirtualListState,
  type VirtualListItem,
} from "@/lib/virtual-list";

export type ChunksPanelProps = {
  chunks: ParsedChunkView[];
  selectedSource?: string | null;
  focusedChunkId?: string | null;
  focusedChunkRequestId?: number;
  isLoading?: boolean;
};

type ViewportState = {
  scrollTop: number;
  height: number;
};

const estimatedChunkCardHeight = 220;
const virtualListOverscan = 4;

export function ChunksPanel({
  chunks = [],
  selectedSource = null,
  focusedChunkId = null,
  focusedChunkRequestId = 0,
  isLoading = false,
}: Partial<ChunksPanelProps> = {}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const measuredHeightsRef = useRef<ReadonlyMap<number, number>>(new Map());
  const [localFocusedChunkId, setLocalFocusedChunkId] = useState<string | null>(
    null,
  );
  const [viewportState, setViewportState] = useState<ViewportState>({
    scrollTop: 0,
    height: 0,
  });
  const [measuredHeights, setMeasuredHeights] = useState<
    ReadonlyMap<number, number>
  >(() => new Map());
  const activeFocusedChunkId = focusedChunkId ?? localFocusedChunkId;

  useEffect(() => {
    measuredHeightsRef.current = measuredHeights;
  }, [measuredHeights]);

  const syncViewportState = useCallback((viewport: HTMLDivElement): void => {
    const nextState: ViewportState = {
      scrollTop: viewport.scrollTop,
      height: viewport.clientHeight,
    };

    setViewportState((currentState) =>
      currentState.scrollTop === nextState.scrollTop &&
      currentState.height === nextState.height
        ? currentState
        : nextState,
    );
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    syncViewportState(viewport);

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      syncViewportState(viewport);
    });
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [syncViewportState]);

  const handleViewportScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      syncViewportState(event.currentTarget);
    },
    [syncViewportState],
  );

  const handleChunkMeasured = useCallback(
    (index: number, height: number): void => {
      setMeasuredHeights((currentHeights) => {
        if (currentHeights.get(index) === height) {
          return currentHeights;
        }

        const nextHeights = new Map(currentHeights);
        nextHeights.set(index, height);
        return nextHeights;
      });
    },
    [],
  );

  const virtualListState = useMemo(
    () =>
      getVirtualListState({
        itemCount: chunks.length,
        scrollTop: viewportState.scrollTop,
        viewportHeight: viewportState.height,
        estimatedItemHeight: estimatedChunkCardHeight,
        overscan: virtualListOverscan,
        measuredHeights,
      }),
    [
      chunks.length,
      measuredHeights,
      viewportState.height,
      viewportState.scrollTop,
    ],
  );

  const focusedChunkIndex = useMemo(
    () =>
      activeFocusedChunkId
        ? chunks.findIndex((chunk) => chunk.chunkId === activeFocusedChunkId)
        : -1,
    [activeFocusedChunkId, chunks],
  );
  const isFocusedChunkRendered = useMemo(
    () =>
      focusedChunkIndex >= 0 &&
      virtualListState.items.some((item) => item.index === focusedChunkIndex),
    [focusedChunkIndex, virtualListState.items],
  );

  const scrollToChunkIndex = useCallback((index: number): void => {
    const viewport = viewportRef.current;

    if (!viewport || index < 0) {
      return;
    }

    const focusedOffset = getItemOffset({
      index,
      estimatedItemHeight: estimatedChunkCardHeight,
      measuredHeights: measuredHeightsRef.current,
    });
    const centeredScrollTop = Math.max(
      0,
      focusedOffset - viewport.clientHeight / 2 + estimatedChunkCardHeight / 2,
    );

    viewport.scrollTo({
      top: centeredScrollTop,
      behavior: "smooth",
    });
  }, []);

  const requestChunkFocus = useCallback(
    (chunkId: string): void => {
      const index = chunks.findIndex((chunk) => chunk.chunkId === chunkId);

      if (index < 0) {
        return;
      }

      setLocalFocusedChunkId(chunkId);
      scrollToChunkIndex(index);
    },
    [chunks, scrollToChunkIndex],
  );

  useEffect(() => {
    if (focusedChunkId) {
      requestChunkFocus(focusedChunkId);
    }
  }, [focusedChunkId, focusedChunkRequestId, requestChunkFocus]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const focusedElement = viewport?.querySelector<HTMLElement>(
      '[data-focused-chunk="true"]',
    );

    if (activeFocusedChunkId && focusedElement) {
      focusedElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeFocusedChunkId, isFocusedChunkRendered]);

  const headerTitle = focusedChunkId ? "Referenced Chunks" : "Parsed Chunks";

  const headerSubtitle = focusedChunkId ? (
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
      <header className="flex shrink-0 items-start justify-between border-b border-border/70 px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">{headerTitle}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground sm:truncate">
            {headerSubtitle}
          </p>
        </div>
      </header>

      <ScrollArea
        className="flex-1"
        viewportRef={viewportRef}
        onViewportScroll={handleViewportScroll}
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
              style={{ height: virtualListState.totalHeight }}
              aria-label="Parsed chunks"
            >
              {virtualListState.items.map((virtualItem) => (
                <VirtualChunkRow
                  key={chunks[virtualItem.index]?.chunkId ?? virtualItem.index}
                  virtualItem={virtualItem}
                  chunk={chunks[virtualItem.index]}
                  focusedChunkId={activeFocusedChunkId}
                  onMeasure={handleChunkMeasured}
                  onReferenceClick={requestChunkFocus}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}

function EmptyChunks() {
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

function LoadingChunks() {
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
  onMeasure,
  onReferenceClick,
}: {
  virtualItem: VirtualListItem;
  chunk: ParsedChunkView | undefined;
  focusedChunkId: string | null;
  onMeasure: (index: number, height: number) => void;
  onReferenceClick: (chunkId: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = rowRef.current;

    if (!row) {
      return;
    }

    const measureRow = (): void => {
      onMeasure(virtualItem.index, row.getBoundingClientRect().height);
    };

    measureRow();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(measureRow);
    observer.observe(row);

    return () => {
      observer.disconnect();
    };
  }, [onMeasure, virtualItem.index]);

  if (!chunk) {
    return null;
  }

  const rowStyle: CSSProperties = {
    position: "absolute",
    transform: `translateY(${virtualItem.top}px)`,
    width: "100%",
  };

  return (
    <div
      ref={rowRef}
      style={rowStyle}
      className="w-full min-w-0 pb-3 sm:pb-4"
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

function ChunkCard({
  chunk,
  isFocused,
  onReferenceClick,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
  onReferenceClick: (chunkId: string) => void;
}) {
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

function ChunkHeader({ chunk }: { chunk: ParsedChunkView }) {
  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <Badge
        variant="secondary"
        className="max-w-full whitespace-normal rounded-full border-blue-100 bg-blue-50 px-2.5 py-1 text-left text-[10px] uppercase tracking-tight text-blue-700 hover:bg-blue-50"
      >
        {chunk.sourceTitle}
        {chunk.summary ? ` · ${chunk.summary}` : ""}
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        {chunk.type}
      </Badge>
    </div>
  );
}

function ChunkKeywords({
  keywords,
}: {
  keywords: ParsedChunkView["keywords"];
}) {
  if (!keywords || keywords.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1">
      {keywords.map((kw) => (
        <Badge
          key={kw}
          variant="secondary"
          className="px-1.5 py-0 text-[10px]"
        >
          {kw}
        </Badge>
      ))}
    </div>
  );
}

function focusCardClasses(isFocused: boolean): string {
  return isFocused
    ? "border-primary bg-primary/5 ring-2 ring-primary/40 shadow-md"
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
}) {
  return (
    <Card
      className={`w-full min-w-0 overflow-hidden cursor-default shadow-xs transition-colors ${focusCardClasses(isFocused)}`}
    >
      <CardContent className="p-4 sm:p-5">
        <ChunkHeader chunk={chunk} />
        <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-foreground sm:text-sm">
          {renderTextChunkContent(chunk, onReferenceClick)}
        </pre>
        <ChunkKeywords keywords={chunk.keywords} />
      </CardContent>
    </Card>
  );
}

function ImageChunkCard({
  chunk,
  isFocused,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
}) {
  return (
    <Card
      className={`w-full min-w-0 overflow-hidden cursor-default shadow-xs transition-colors ${focusCardClasses(isFocused)}`}
    >
      <CardContent className="p-4 sm:p-5">
        <ChunkHeader chunk={chunk} />
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
        <ChunkKeywords keywords={chunk.keywords} />
      </CardContent>
    </Card>
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
}) {
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
}) {
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
    <Card
      className={`w-full min-w-0 overflow-hidden cursor-default shadow-xs transition-colors ${focusCardClasses(isFocused)}`}
    >
      <CardContent className="p-4 sm:p-5">
        <ChunkHeader chunk={chunk} />
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
        <ChunkKeywords keywords={chunk.keywords} />
      </CardContent>
    </Card>
  );
}
