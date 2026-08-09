"use client";

import type { ReactElement } from "react";
import { FileText, ListTree, RotateCcw, Trash2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import type { SourceView } from "@/domains/sources/types";

export type SourceRowProps = {
  readonly onTreeClick?: () => void;
  readonly isArchiving: boolean;
  readonly isNarrow?: boolean;
  readonly isRetrying?: boolean;
  readonly isSelected: boolean;
  readonly onArchiveClick?: (sourceId: string) => void;
  readonly onRetryClick?: (sourceId: string) => void;
  readonly onSelect: () => void;
  readonly onToggleIncluded?: (sourceId: string, included: boolean) => void;
  readonly source: SourceView;
};

export function SourceRow({
  source,
  isSelected,
  isNarrow = false,
  onSelect,
  onToggleIncluded,
  onArchiveClick,
  onRetryClick,
  onTreeClick,
  isArchiving,
  isRetrying = false,
}: SourceRowProps): ReactElement {
  const isReady = source.status === "ready";
  const isBusy = source.status === "uploading" || source.status === "parsing";
  const isFailed = source.status === "failed";
  const canRetry = isFailed && source.originalFile !== undefined;
  const isRemoteSource = source.kind === "remote";

  const iconBg = fileIconTint(source.title);

  return (
    <div
      data-testid="source-row"
      className={`grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center text-left transition-colors ${
        isNarrow ? "gap-1.5 rounded-lg p-1.5" : "gap-2 rounded-lg p-2"
      } ${
        isSelected
          ? "border border-border/70 bg-muted/60 shadow-xs"
          : "border border-border/70 bg-background hover:bg-muted/40"
      } ${!isReady ? "opacity-90" : ""}`}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex items-center"
      >
        <Checkbox
          checked={!source.excludedFromQuery}
          disabled={!isReady || !onToggleIncluded || isRemoteSource}
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
        className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center text-left ${
          isNarrow ? "gap-1.5" : "gap-2"
        }`}
        aria-label={`Open ${source.title} parsed chunks`}
      >
        <div
          className={`flex shrink-0 items-center justify-center rounded-lg ${iconBg.bg} ${iconBg.fg} ${
            isNarrow ? "size-7" : "size-8"
          }`}
        >
          <FileText className="size-4" />
        </div>
        <div className="min-w-0 overflow-hidden">
          <p className="truncate text-sm font-medium text-foreground">
            {source.title}
          </p>
          <p
            className={`truncate text-[10px] font-bold uppercase tracking-wider ${
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
              ? `${getReadySourceLabel(source)} · ${source.chunkCount ?? 0} chunks`
              : source.status === "parsing"
                ? "Preparing"
                : source.status === "uploading"
                  ? "Uploading"
                  : "Failed"}
          </p>
          {isFailed && source.failureMessage ? (
            <p className="mt-0.5 truncate text-[11px] font-medium normal-case tracking-normal text-destructive/80">
              {source.failureMessage}
            </p>
          ) : null}
        </div>
      </button>
      <div className="flex shrink-0 items-center justify-self-end">
        {onTreeClick && isReady ? (
          <button
            type="button"
            onClick={onTreeClick}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Open ${source.title} chunk tree link`}
            title="Open chunk tree"
          >
            <ListTree className="size-3.5" />
          </button>
        ) : null}
        {canRetry && onRetryClick ? (
          <button
            type="button"
            disabled={isRetrying || isArchiving}
            onClick={(event) => {
              event.stopPropagation();
              if (isRetrying || isArchiving) return;
              onRetryClick(source.id);
            }}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:cursor-wait disabled:opacity-70"
            aria-label={`Retry ${source.title} processing`}
            title="Retry processing"
          >
            {isRetrying ? (
              <Spinner className="size-3.5" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
          </button>
        ) : null}
        {onArchiveClick && (
          <button
            type="button"
            disabled={isArchiving}
            onClick={(event) => {
              event.stopPropagation();
              if (isArchiving) return;
              onArchiveClick(source.id);
            }}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-wait disabled:opacity-70"
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
    </div>
  );
}

function getReadySourceLabel(source: SourceView): string {
  if (source.kind === "remote") return "Remote";
  return "Processed";
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
