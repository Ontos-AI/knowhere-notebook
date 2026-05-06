"use client";

import { useState } from "react";
import { Plus, Upload, FileText, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SourceView } from "@/lib/types";

export type SourcesPanelProps = {
  sources: SourceView[];
  selectedSourceId?: string | null;
  onSelectSource?: (sourceId: string | null) => void;
  onToggleIncluded?: (sourceId: string, included: boolean) => void;
  onUpload?: (file: File) => void;
};

/**
 * Left sidebar: the catalog of uploaded sources.
 *
 * Each row:
 *  - checkbox → drives excludeDocumentIds on the next query
 *  - file-type badge (color per extension)
 *  - filename + status line ("Processed · 42 sections", "Processing · 85%", etc.)
 *
 * Clicking a row selects/deselects it. Selection drives the middle Parsed
 * Content panel (see page.tsx).
 */
export function SourcesPanel({
  sources = [],
  selectedSourceId = null,
  onSelectSource,
  onToggleIncluded,
  onUpload,
}: Partial<SourcesPanelProps> = {}) {
  return (
    <aside className="z-10 flex w-[260px] shrink-0 flex-col border-r border-border bg-background lg:w-[320px]">
      <div className="border-b border-border p-4">
        <UploadDialog onUpload={onUpload} />
      </div>
      <ScrollArea className="flex-1">
        <div className="px-4 py-4">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Indexed Sources
          </h3>

          {sources.length === 0 ? (
            <EmptySourcesState />
          ) : (
            <div className="flex flex-col gap-1.5">
              {sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  isSelected={source.id === selectedSourceId}
                  onSelect={() =>
                    onSelectSource?.(
                      source.id === selectedSourceId ? null : source.id
                    )
                  }
                  onToggleIncluded={onToggleIncluded}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function UploadDialog({ onUpload }: { onUpload?: (file: File) => void }) {
  const [isUploading, setIsUploading] = useState(false);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button className="flex w-full items-center justify-center gap-2 shadow-sm" />
        }
      >
        <Plus className="size-4" />
        Upload Document
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Document Source</DialogTitle>
          <DialogDescription>
            Upload documents to your workspace to initiate parsing and indexing.
            We support PDF, DOCX, TXT, MD, and PPTX up to 25MB.
          </DialogDescription>
        </DialogHeader>
        <label
          className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/40 p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted"
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="size-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Processing Document…
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This notification will clear when parsing completes.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-border bg-background shadow-sm">
                <Upload className="size-6 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                Click to select or drag and drop a document
              </p>
              <p className="mt-2 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                Max size: 25 MB
              </p>
            </>
          )}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.md,.ppt,.pptx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setIsUploading(true);
              onUpload?.(file);
            }}
          />
        </label>
      </DialogContent>
    </Dialog>
  );
}

function EmptySourcesState() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Database className="size-5" />
      </div>
      <p className="text-xs font-semibold text-foreground">
        No indexed sources available.
      </p>
      <p className="mt-1 max-w-[180px] text-[11px] text-muted-foreground">
        Upload a document to initiate parsing and enable questions.
      </p>
    </div>
  );
}

function SourceRow({
  source,
  isSelected,
  onSelect,
  onToggleIncluded,
}: {
  source: SourceView;
  isSelected: boolean;
  onSelect: () => void;
  onToggleIncluded?: (sourceId: string, included: boolean) => void;
}) {
  const isReady = source.status === "ready";
  const isBusy = source.status === "uploading" || source.status === "parsing";
  const isFailed = source.status === "failed";

  const iconBg = fileIconTint(source.title);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-md border p-2 text-left transition-colors ${
        isSelected
          ? "border-border bg-muted/60 shadow-sm"
          : "border-transparent hover:bg-muted/40"
      } ${!isReady ? "opacity-90" : ""}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center"
      >
        <Checkbox
          checked={!source.excludedFromQuery}
          disabled={!isReady}
          onCheckedChange={(checked) =>
            onToggleIncluded?.(source.id, checked === true)
          }
          aria-label={`Include ${source.title} in chat`}
        />
      </div>
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded ${iconBg.bg} ${iconBg.fg}`}
      >
        <FileText className="size-4" />
      </div>
      <div className="min-w-0 overflow-hidden">
        <p className="truncate text-sm font-medium text-foreground">
          {source.title}
        </p>
        <p
          className={`text-[10px] font-bold uppercase tracking-wider ${
            isReady
              ? "text-green-600"
              : isFailed
              ? "text-destructive"
              : isBusy
              ? "text-amber-500"
              : "text-muted-foreground"
          }`}
        >
          {isReady
            ? `Processed · ${source.chunkCount ?? 0} sections`
            : source.status === "parsing"
            ? "Processing"
            : source.status === "uploading"
            ? "Uploading"
            : "Failed"}
        </p>
      </div>
    </button>
  );
}

/**
 * Small per-filetype color hint so the sidebar reads at a glance.
 * No semantic meaning — pure cosmetics.
 */
function fileIconTint(title: string): { bg: string; fg: string } {
  const ext = title.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return { bg: "bg-blue-100", fg: "text-blue-600" };
    case "docx":
    case "doc":
      return { bg: "bg-purple-100", fg: "text-primary" };
    case "md":
      return { bg: "bg-emerald-100", fg: "text-emerald-600" };
    case "ppt":
    case "pptx":
      return { bg: "bg-orange-100", fg: "text-orange-600" };
    default:
      return { bg: "bg-muted", fg: "text-muted-foreground" };
  }
}
