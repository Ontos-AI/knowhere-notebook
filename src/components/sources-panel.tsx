"use client";

import { useState } from "react";
import { Upload, FileText, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type Source = {
  id: string;
  title: string;
  status: "uploading" | "parsing" | "ready" | "failed";
  chunkCount?: number;
};

export function SourcesPanel() {
  const [sources] = useState<Source[]>([]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Sources</h2>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
          <Plus className="h-4 w-4" />
          <span className="sr-only">Add source</span>
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        {sources.length === 0 ? (
          <EmptySourcesState />
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {sources.map((source) => (
              <SourceItem key={source.id} source={source} />
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}

function EmptySourcesState() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Upload className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">No sources yet</p>
        <p className="text-xs text-muted-foreground">
          Upload a document to get started. PDFs, Word docs, and text files are
          supported.
        </p>
      </div>
      <Button size="sm" className="mt-2">
        <Upload className="mr-2 h-3.5 w-3.5" />
        Upload document
      </Button>
    </div>
  );
}

function SourceItem({ source }: { source: Source }) {
  return (
    <button
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
      type="button"
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{source.title}</span>
      {source.status === "uploading" || source.status === "parsing" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : source.status === "ready" ? (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {source.chunkCount} chunks
        </Badge>
      ) : (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          Failed
        </Badge>
      )}
    </button>
  );
}
