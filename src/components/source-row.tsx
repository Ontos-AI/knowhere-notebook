"use client";

import type { ReactElement } from "react";
import { FileText, Trash2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import type { SourceView } from "@/domains/sources/types";

export type SourceRowProps = {
  readonly isArchiving: boolean;
  readonly isSelected: boolean;
  readonly onArchiveClick?: (sourceId: string) => void;
  readonly onSelect: () => void;
  readonly onToggleIncluded?: (sourceId: string, included: boolean) => void;
  readonly source: SourceView;
};

export function SourceRow({
  source,
  isSelected,
  onSelect,
  onToggleIncluded,
  onArchiveClick,
  isArchiving,
}: SourceRowProps): ReactElement {
  const isReady = source.status === "ready";
  const isBusy = source.status === "uploading" || source.status === "parsing";
  const isFailed = source.status === "failed";

  const iconBg = fileIconTint(source.title);

  return (
    <div
      className={`flex w-full items-center gap-2.5 rounded-2xl border p-2 text-left transition-colors ${
        isSelected
          ? "border-border/70 bg-muted/60 shadow-xs"
          : "border-transparent hover:bg-muted/40"
      } ${!isReady ? "opacity-90" : ""}`}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex items-center"
      >
        <Checkbox
          checked={!source.excludedFromQuery}
          disabled={!isReady || !onToggleIncluded}
          onCheckedChange={(checked) =>
            onToggleIncluded?.(source.id, checked === true)
          }
          aria-label={`Use ${source.title} in answers`}
        />
      </div>
      <button
        type="button"
        onClick={onSelect}
        disabled={isArchiving}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        aria-label={`Open ${source.title} parsed chunks`}
      >
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${iconBg.bg} ${iconBg.fg}`}
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
              ? `Processed · ${source.chunkCount ?? 0} chunks`
              : source.status === "parsing"
                ? "Preparing"
                : source.status === "uploading"
                  ? "Uploading"
                  : "Failed"}
          </p>
        </div>
      </button>
      {onArchiveClick && (
        <button
          type="button"
          disabled={isArchiving}
          onClick={(event) => {
            event.stopPropagation();
            if (isArchiving) return;
            onArchiveClick(source.id);
          }}
          className="ml-auto shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-wait disabled:opacity-70"
          aria-label={`Delete ${source.title}`}
        >
          {isArchiving ? (
            <Spinner className="size-3.5" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

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
    case "xls":
    case "xlsx":
      return { bg: "bg-green-100", fg: "text-green-700" };
    case "jpg":
    case "jpeg":
    case "png":
      return { bg: "bg-sky-100", fg: "text-sky-600" };
    case "ppt":
    case "pptx":
      return { bg: "bg-orange-100", fg: "text-orange-600" };
    default:
      return { bg: "bg-muted", fg: "text-muted-foreground" };
  }
}
