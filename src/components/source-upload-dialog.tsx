"use client";

import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SourceView } from "@/domains/sources/types";
import { postSourceUpload } from "@/domains/sources/upload-request";

type UploadDialogState = {
  readonly ok: boolean;
  readonly message: string | null;
  readonly source?: SourceView;
};

export type SourceUploadDialogProps = {
  readonly onSourceUploaded?: (source: SourceView) => void;
};

export function SourceUploadDialog({
  onSourceUploaded,
}: SourceUploadDialogProps): ReactElement {
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
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
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
