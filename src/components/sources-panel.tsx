"use client";

import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
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
import { Spinner } from "@/components/ui/spinner";
import type { SourceView } from "@/lib/types";
import { postSourceUpload } from "@/lib/source-upload-request";

export type SourcesPanelProps = {
  sources: SourceView[];
  onSourceUploaded?: (source: SourceView) => void;
  selectedSourceId?: string | null;
  onSelectSource?: (sourceId: string | null) => void;
  onToggleIncluded?: (sourceId: string, included: boolean) => void;
  onArchiveSource?: (sourceId: string) => void;
  archivingSourceIds?: readonly string[];
  /** When provided, the Upload button redirects to login instead of opening the dialog. */
  onLoginClick?: () => void;
};

type UploadDialogState = {
  ok: boolean;
  message: string | null;
  source?: SourceView;
};

export function SourcesPanel({
  sources = [],
  onSourceUploaded,
  selectedSourceId = null,
  onSelectSource,
  onToggleIncluded,
  onArchiveSource,
  archivingSourceIds = [],
  onLoginClick,
}: Partial<SourcesPanelProps> = {}) {
  const [confirmSourceId, setConfirmSourceId] = useState<string | null>(null);
  const confirmSource = sources.find((s) => s.id === confirmSourceId) ?? null;
  const archivingSourceIdSet: ReadonlySet<string> = new Set(archivingSourceIds);
  const isConfirmSourceArchiving =
    confirmSourceId !== null && archivingSourceIdSet.has(confirmSourceId);

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
              disabled={isConfirmSourceArchiving}
              onClick={() => {
                if (confirmSourceId) {
                  onArchiveSource?.(confirmSourceId);
                  if (!archivingSourceIdSet.has(confirmSourceId)) {
                    setConfirmSourceId(null);
                  }
                }
              }}
            >
              {isConfirmSourceArchiving ? (
                <>
                  <Spinner className="size-3.5" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="border-b border-border/70 p-4">
        {onLoginClick ? (
          <Button
            onClick={onLoginClick}
            size="sm"
            className="flex w-full items-center justify-center gap-2 shadow-xs"
          >
            <Plus className="size-4" />
            Log in to upload
          </Button>
        ) : (
          <UploadDialog onSourceUploaded={onSourceUploaded} />
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
                  isArchiving={archivingSourceIdSet.has(source.id)}
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
}: {
  onSourceUploaded?: (source: SourceView) => void;
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [state, setState] = useState<UploadDialogState>({
    ok: true,
    message: null,
  });
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastUploadedSourceIdRef = useRef<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputId = useId();

  useEffect(() => {
    if (
      state.ok &&
      state.source &&
      state.source.id !== lastUploadedSourceIdRef.current
    ) {
      if (inputRef.current) inputRef.current.value = "";
      setSelectedFile(null);
      setSelectedFileName(null);
      lastUploadedSourceIdRef.current = state.source.id;
      onSourceUploaded?.(state.source);
      setIsDialogOpen(false);
    }
  }, [state, onSourceUploaded]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isUploading) return;

    const file = selectedFile ?? inputRef.current?.files?.[0] ?? null;
    if (!file || file.size === 0) {
      setState({ ok: false, message: "Choose a document to upload." });
      return;
    }

    setIsUploading(true);
    setState({ ok: true, message: null });

    try {
      const response = await postSourceUpload(file);
      const { body } = response;

      if (!isSuccessfulStatus(response.status) || !body.source) {
        setState({
          ok: false,
          message:
            body.message ?? "Upload failed. Try again or choose another file.",
        });
        return;
      }

      setState({ ok: true, message: null, source: body.source });
    } catch {
      setState({
        ok: false,
        message: "Upload failed. Try again or choose another file.",
      });
    } finally {
      setIsUploading(false);
    }
  }

  function handleDialogDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDialogDrop(event: DragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();

    if (isUploading) return;

    const file = event.dataTransfer.files.item(0);
    if (!file) return;

    setSelectedFile(file);
    setSelectedFileName(file.name);
    setState({ ok: true, message: null });
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <Button
        type="button"
        onClick={() => setIsDialogOpen(true)}
        size="sm"
        className="flex w-full items-center justify-center gap-2 shadow-xs"
      >
        <Plus className="size-4" />
        Upload Document
      </Button>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 sm:max-w-[425px]"
        onDragOver={handleDialogDragOver}
        onDrop={handleDialogDrop}
      >
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>Add source</DialogTitle>
          <DialogDescription>
            Add a document to your notebook. Notebook accepts PDF, DOC, DOCX,
            TXT, MD, XLS, XLSX, PPTX, images, and more files up to 100 MB.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
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
                accept=".pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.pptx,.jpg,.jpeg,.png"
                disabled={isUploading}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  setSelectedFileName(file?.name ?? null);
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
              disabled={isUploading}
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

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
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
  isArchiving,
}: {
  source: SourceView;
  isSelected: boolean;
  onSelect: () => void;
  onToggleIncluded?: (sourceId: string, included: boolean) => void;
  onArchiveClick?: (sourceId: string) => void;
  isArchiving: boolean;
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
          onClick={(e) => {
            e.stopPropagation();
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
