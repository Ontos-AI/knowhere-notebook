"use client";

import { Layers, FileSearch } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { ParsedChunkView } from "@/lib/types";

export type ChunksPanelProps = {
  /**
   * Chunks to render. This is a pure view — the panel does not own or
   * persist chunk state. In the MVP wiring, these arrive from the Knowhere
   * chunks API via a server action, not from a local database.
   */
  chunks: ParsedChunkView[];
  isLoading?: boolean;
};

export function ChunksPanel({
  chunks = [],
  isLoading = false,
}: Partial<ChunksPanelProps> = {}) {
  const hasChunks = chunks.length > 0;

  return (
    <section className="flex flex-1 flex-col border-r border-border">
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          Parsed Content
        </h2>
        {hasChunks && (
          <Badge variant="secondary" className="text-[10px]">
            {chunks.length} chunks
          </Badge>
        )}
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        {isLoading ? (
          <LoadingChunksState />
        ) : !hasChunks ? (
          <EmptyChunksState />
        ) : (
          <div className="flex flex-col gap-2 p-4">
            {chunks.map((chunk) => (
              <ChunkCard key={chunk.chunkId} chunk={chunk} />
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}

function EmptyChunksState() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Layers className="size-5 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          No content parsed yet
        </p>
        <p className="text-xs text-muted-foreground">
          Upload a document on the left to see its parsed chunks here. Each
          chunk is a meaningful section of your document.
        </p>
      </div>
    </div>
  );
}

function LoadingChunksState() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Layers className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">Loading parsed content…</p>
    </div>
  );
}

function ChunkCard({ chunk }: { chunk: ParsedChunkView }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm">
      <div className="mb-1.5 flex items-center gap-2">
        <FileSearch className="size-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {chunk.sourceTitle}
        </span>
        <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">
          {chunk.type}
        </Badge>
      </div>
      <p className="line-clamp-4 text-foreground">{chunk.content}</p>
      {chunk.keywords && chunk.keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chunk.keywords.map((kw) => (
            <Badge
              key={kw}
              variant="secondary"
              className="text-[10px] px-1.5 py-0"
            >
              {kw}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
