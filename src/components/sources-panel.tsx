"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Plus, Upload, FileText, Database, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SourceView } from "@/lib/types";
import type { UploadSourceActionState } from "@/app/actions";

export type SourcesPanelProps = {
  sources: SourceView[];
  onSourceUploaded?: (source: SourceView) => void;
  selectedSourceId?: string | null;
  onSelectSource?: (sourceId: string | null) => void;
  onToggleIncluded?: (sourceId: string, included: boolean) => void;
  onArchiveSource?: (sourceId: string) => void;
  uploadAction?: (
    state: UploadSourceActionState,
    formData: FormData,
  ) => Promise<UploadSourceActionState>;
  /** When provided, the Upload button redirects to login instead of opening the dialog. */
  onLoginClick?: () => void;
};

export function SourcesPanel({
  sources = [],
  onSourceUploaded,
  selectedSourceId = null,
  onSelectSource,
  onToggleIncluded,
  onArchiveSource,
  uploadAction,
  onLoginClick,
}: Partial<SourcesPanelProps> = {}) {
  const [confirmSourceId, setConfirmSourceId] = useState<string | null>(null);
  const confirmSource = sources.find((s) => s.id === confirmSourceId) ?? null;

  return (
    <aside className="z-10 flex h-full w-full shrink-0 flex-col border-r border-border/70 bg-background">
      <AlertDialog
        open={confirmSourceId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmSourceId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmSource
                ? `Delete "${confirmSource.title}"? This removes the document from your notebook.`
                : "Delete this document? This removes the document from your notebook."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmSourceId) {
                  onArchiveSource?.(confirmSourceId);
                  setConfirmSourceId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="border-b border-border/70 p-4">
        {onLoginClick ? (
          <Button
            onClick={onLoginClick}
            variant="outline"
            size="sm"
            className="flex w-full items-center justify-center gap-2 shadow-xs"
          >
            <Plus className="size-4" />
            Log in to upload
          </Button>
        ) : uploadAction ? (
          <UploadDialog
            onSourceUploaded={onSourceUploaded}
            uploadAction={uploadAction}
          />
        ) : (
          <UploadDialog />
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="px-4 py-4">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Sources
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
                  onArchiveClick={
                    onArchiveSource ? setConfirmSourceId : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function UploadDialog({
  onSourceUploaded,
  uploadAction,
}: {
  onSourceUploaded?: (source: SourceView) => void;
  uploadAction?: SourcesPanelProps["uploadAction"];
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [state, formAction, isUploading] = useActionState(
    uploadAction ?? disabledUploadAction,
    { ok: true, message: null },
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const lastUploadedSourceIdRef = useRef<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputId = useId();

  useEffect(() => {
    if (state.ok) {
      if (inputRef.current) inputRef.current.value = "";
    }
    if (
      state.ok &&
      state.source &&
      state.source.id !== lastUploadedSourceIdRef.current
    ) {
      lastUploadedSourceIdRef.current = state.source.id;
      onSourceUploaded?.(state.source);
      setIsDialogOpen(false);
    }
  }, [state, onSourceUploaded]);

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <Button
        type="button"
        onClick={() => setIsDialogOpen(true)}
        variant="outline"
        size="sm"
        className="flex w-full items-center justify-center gap-2 shadow-xs"
      >
        <Plus className="size-4" />
        Upload Document
      </Button>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 sm:max-w-[425px]">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>Add source</DialogTitle>
          <DialogDescription>
            Add a document to your notebook. Notebook accepts PDF, DOC, DOCX,
            TXT, MD, PPT, PPTX, and more files up to 100 MB.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 overflow-y-auto px-6 py-4">
            <label
              htmlFor={fileInputId}
              className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/40 p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted"
            >
              {isUploading ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="size-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Uploading document…
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Notebook is preparing your document for questions.
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
                    Max size: 100 MB
                  </p>
                  {selectedFileName && (
                    <p className="mt-3 max-w-full truncate text-xs font-medium text-foreground">
                      Selected: {selectedFileName}
                    </p>
                  )}
                </>
              )}
              <input
                id={fileInputId}
                ref={inputRef}
                name="file"
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.md,.ppt,.pptx"
                disabled={isUploading}
                onChange={(e) => {
                  setSelectedFileName(e.target.files?.[0]?.name ?? null);
                }}
              />
            </label>
            {state.message && (
              <p
                className={`mt-4 rounded-md border px-3 py-2 text-xs ${
                  state.ok
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }`}
              >
                {state.message}
              </p>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/70 bg-popover/95 p-4 sm:px-6">
            <Button
              type="submit"
              disabled={isUploading || !uploadAction}
              size="sm"
              className="w-full sm:w-auto"
            >
            {isUploading ? "Uploading…" : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

async function disabledUploadAction(): Promise<UploadSourceActionState> {
  return {
    ok: false,
    message: "Upload is not available yet.",
  };
}

function EmptySourcesState() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Database className="size-5" />
      </div>
      <p className="text-xs font-semibold text-foreground">
        No sources yet.
      </p>
      <p className="mt-1 max-w-[180px] text-[11px] text-muted-foreground">
        Upload a document to read its parsed chunks and ask questions.
      </p>
    </div>
  );
}

function SourceRow({
  source,
  isSelected,
  onSelect,
  onToggleIncluded,
  onArchiveClick,
}: {
  source: SourceView;
  isSelected: boolean;
  onSelect: () => void;
  onToggleIncluded?: (sourceId: string, included: boolean) => void;
  onArchiveClick?: (sourceId: string) => void;
}) {
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
        onClick={(e) => e.stopPropagation()}
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
          onClick={(e) => {
            e.stopPropagation();
            onArchiveClick(source.id);
          }}
          className="ml-auto shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${source.title}`}
        >
          <Trash2 className="size-3.5" />
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
    case "ppt":
    case "pptx":
      return { bg: "bg-orange-100", fg: "text-orange-600" };
    default:
      return { bg: "bg-muted", fg: "text-muted-foreground" };
  }
}
