"use client";

import { useEffect, useRef } from "react";
import { X, Layers } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ParsedChunkView } from "@/lib/types";

export type ChunksPanelProps = {
  chunks: ParsedChunkView[];
  /** When set, only chunks from this source are shown. */
  selectedSource?: string | null;
  /** When set, scrolls/highlights the matching chunk (by chunkId). */
  focusedChunkId?: string | null;
  isLoading?: boolean;
  onClose?: () => void;
};

/**
 * Center panel: parsed content sections.
 *
 * Two modes, controlled by the parent:
 *   - source mode — shows all chunks for the selected source
 *   - citation mode — shows the retrieved chunks from the last chat turn,
 *     optionally scrolled to the clicked citation
 *
 * This is a pure view. Sections arrive as props; fetching/selection logic is
 * the page's responsibility.
 */
export function ChunksPanel({
  chunks = [],
  selectedSource = null,
  focusedChunkId = null,
  isLoading = false,
  onClose,
}: Partial<ChunksPanelProps> = {}) {
  const focusedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusedChunkId && focusedRef.current) {
      focusedRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [focusedChunkId]);

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
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close parsed content"
          >
            <X />
          </Button>
        )}
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center p-6">
          {isLoading ? (
            <LoadingSections />
          ) : chunks.length === 0 ? (
            <EmptySections />
          ) : (
            <div className="flex w-full flex-col gap-4">
              {chunks.map((chunk) => (
                <ChunkCard
                  key={chunk.chunkId}
                  chunk={chunk}
                  isFocused={chunk.chunkId === focusedChunkId}
                  focusRef={
                    chunk.chunkId === focusedChunkId ? focusedRef : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
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
  focusRef,
}: {
  chunk: ParsedChunkView;
  isFocused: boolean;
  focusRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={focusRef}>
      <Card
        className={`cursor-default shadow-sm transition-colors ${
          isFocused
            ? "border-primary ring-1 ring-primary/20"
            : "hover:border-primary/30"
        }`}
      >
        <CardContent className="p-5">
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
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {chunk.content}
          </p>
          {chunk.keywords && chunk.keywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {chunk.keywords.map((kw) => (
                <Badge
                  key={kw}
                  variant="secondary"
                  className="px-1.5 py-0 text-[10px]"
                >
                  {kw}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
