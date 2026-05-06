"use client";

import { Upload, FileText, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { SourceView } from "@/lib/types";

export type SourcesPanelProps = {
  sources: SourceView[];
  onAdd?: () => void;
  onSelect?: (sourceId: string) => void;
};

export function SourcesPanel({
  sources = [],
  onAdd,
  onSelect,
}: Partial<SourcesPanelProps> = {}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Sources</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onAdd}
          aria-label="Add source"
        >
          <Plus />
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        {sources.length === 0 ? (
          <EmptySourcesState onAdd={onAdd} />
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {sources.map((source) => (
              <SourceItem
                key={source.id}
                source={source}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}

function EmptySourcesState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Upload className="size-5 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">No sources yet</p>
        <p className="text-xs text-muted-foreground">
          Upload a document to get started. PDFs, Word docs, and text files are
          supported.
        </p>
      </div>
      <Button size="sm" onClick={onAdd} className="mt-2">
        <Upload data-icon="inline-start" />
        Upload document
      </Button>
    </div>
  );
}

function SourceItem({
  source,
  onSelect,
}: {
  source: SourceView;
  onSelect?: (sourceId: string) => void;
}) {
  const isBusy = source.status === "uploading" || source.status === "parsing";

  return (
    <button
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
      type="button"
      onClick={() => onSelect?.(source.id)}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{source.title}</span>
      {isBusy ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      ) : source.status === "ready" ? (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {source.chunkCount ?? 0} chunks
        </Badge>
      ) : (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          Failed
        </Badge>
      )}
    </button>
  );
}
