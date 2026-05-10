"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { ImageIcon, Layers, Table2 } from "lucide-react";
import DOMPurify from "dompurify";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ParsedChunkView } from "@/lib/types";

const OVERSCAN_COUNT = 1; // mobile-friendly: small viewport needs few extras
const BASE_PADDING_PX = 120;         // card chrome (header, badges, padding)
const LINE_HEIGHT_PX = 22;
const CHARS_PER_LINE = 90;           // approximate at max-w-4xl + px-5
const IMAGE_ESTIMATE_PX = 280;
const TABLE_ESTIMATE_PX = 320;

/** Per-chunk height estimate so scrollToIndex is accurate for any content size. */
function estimateChunkHeight(chunk: ParsedChunkView): number {
  if (chunk.type === "image") return IMAGE_ESTIMATE_PX;
  if (chunk.type === "table") return TABLE_ESTIMATE_PX;
  const contentLines = Math.ceil(chunk.content.length / CHARS_PER_LINE) || 1;
  return BASE_PADDING_PX + contentLines * LINE_HEIGHT_PX;
}

export type ChunksPanelProps = {
  chunks: ParsedChunkView[];
  selectedSource?: string | null;
  focusedChunkId?: string | null;
  isLoading?: boolean;
};

export function ChunksPanel({
  chunks = [],
  selectedSource = null,
  focusedChunkId = null,
  isLoading = false,
}: Partial<ChunksPanelProps> = {}) {
  const headerTitle = focusedChunkId
    ? "Referenced Content Sections"
    : "Document Content Sections";

  const headerSubtitle = focusedChunkId ? (
    <>Showing relevant sections from the last answer.</>
  ) : selectedSource ? (
    <>
      Showing all sections from{" "}
      <span className="font-semibold italic text-foreground">
        {selectedSource}
      </span>
    </>
  ) : (
    "Select a source to see its content sections."
  );

  return (
    <main className="z-0 flex flex-[3] flex-col overflow-hidden border-r border-border bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">{headerTitle}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {headerSubtitle}
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <LoadingSections />
        </div>
      ) : chunks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptySections />
        </div>
      ) : (
        <VirtualChunkList
          chunks={chunks}
          focusedChunkId={focusedChunkId}
          ChunkCard={ChunkCard}
        />
      )}
    </main>
  );
}

/**
 * Renders only the chunks visible in the viewport plus a small overscan
 * buffer. For 100+ chunk documents this keeps the DOM light and the scroll
 * frame rate high.  The virtualizer provides `scrollToIndex` for hash-based
 * navigation to off-screen chunks — no DOM node needs to be mounted for the
 * container to scroll to the right position.
 */
function VirtualChunkList({
  chunks,
  focusedChunkId,
  ChunkCard,
}: {
  chunks: ParsedChunkView[];
  focusedChunkId: string | null;
  ChunkCard: React.ComponentType<{
    chunk: ParsedChunkView;
    isFocused: boolean;
    focusRef?: React.RefObject<HTMLDivElement | null>;
  }>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(
      (index: number) => estimateChunkHeight(chunks[index]!),
      [chunks],
    ),
    overscan: OVERSCAN_COUNT,
  });

  // When the focused chunk changes (e.g. citation click or hash change),
  // find its index and tell the virtualizer to scroll there.
  useEffect(() => {
    if (!focusedChunkId) return;
    const index = chunks.findIndex((c) => c.chunkId === focusedChunkId);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    }
  }, [focusedChunkId, chunks, virtualizer]);

  return (
    <div ref={containerRef} className="flex-1 overflow-auto">
      <div
        className="relative mx-auto w-full max-w-4xl px-6 py-4"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const chunk = chunks[virtualItem.index];
          if (!chunk) return null;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute left-6 right-6"
              style={{
                top: 0,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <div className="pb-4">
                <ChunkCard
                  chunk={chunk}
                  isFocused={chunk.chunkId === focusedChunkId}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptySections() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Layers className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">
        No content sections to show yet
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Upload and process a source, then pick it from the sidebar to see its
        content sections.
      </p>
    </div>
  );
}

function LoadingSections() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Layers className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">Loading content sections…</p>
    </div>
  );
}

function ChunkCard({
  chunk,
  isFocused,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
  focusRef?: React.RefObject<HTMLDivElement | null>;
}) {
  if (chunk.type === "image") {
    return <ImageChunkCard chunk={chunk} isFocused={isFocused} />;
  }
  if (chunk.type === "table") {
    return <TableChunkCard chunk={chunk} isFocused={isFocused} />;
  }
  return <TextChunkCard chunk={chunk} isFocused={isFocused} />;
}

function ChunkHeader({ chunk }: { chunk: ParsedChunkView }) {
  return (
    <div className="mb-3 flex items-start justify-between">
      <Badge
        variant="secondary"
        className="rounded-full border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] uppercase tracking-tight text-blue-700 hover:bg-blue-50"
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
    ? "border-primary bg-primary/5 ring-2 ring-primary/40 shadow-md citation-card-highlight"
    : "hover:border-primary/30";
}

function TextChunkCard({
  chunk,
  isFocused,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
}) {
  return (
    <Card
      className={`cursor-default shadow-sm transition-colors ${focusCardClasses(isFocused)}`}
    >
      <CardContent className="p-5">
        <ChunkHeader chunk={chunk} />
        <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground font-sans">
          {chunk.content}
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
      className={`cursor-default shadow-sm transition-colors ${focusCardClasses(isFocused)}`}
    >
      <CardContent className="p-5">
        <ChunkHeader chunk={chunk} />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/40 py-8 text-center">
          <ImageIcon className="size-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Image section
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {chunk.summary ?? "Image content is not available in this view."}
            </p>
          </div>
        </div>
        <ChunkKeywords keywords={chunk.keywords} />
      </CardContent>
    </Card>
  );
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
              "table", "thead", "tbody", "tfoot", "tr", "th", "td",
              "caption", "colgroup", "col",
            ],
            ALLOWED_ATTR: ["colspan", "rowspan", "scope", "align"],
          })
        : null,
    [chunk.content, hasHtml],
  );

  return (
    <Card
      className={`cursor-default shadow-sm transition-colors ${focusCardClasses(isFocused)}`}
    >
      <CardContent className="p-5">
        <ChunkHeader chunk={chunk} />
        {safeHtml ? (
          <div
            className="prose prose-sm max-w-none overflow-x-auto text-sm leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/40 py-8 text-center">
            <Table2 className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Table section
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
