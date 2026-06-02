"use client";

import {
  type DragEvent,
  useId,
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
import { useSourceUploadDialogWorkflow } from "@/components/source-upload-dialog-workflow";
import type { SourceView } from "@/domains/sources/types";
import { MAX_UPLOAD_MB } from "@/domains/sources/validation";

export type SourceUploadDialogProps = {
  readonly onSourceUploaded?: (source: SourceView) => void;
  readonly renderTrigger?: (props: SourceUploadDialogTriggerProps) => ReactElement;
};

export type SourceUploadDialogTriggerProps = {
  readonly isUploading: boolean;
  readonly onClick: () => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
};

export function SourceUploadDialog({
  onSourceUploaded,
  renderTrigger,
}: SourceUploadDialogProps): ReactElement {
  const {
    inputRef,
    isDialogOpen,
    isUploading,
    message,
    selectedFileName,
    handleUploadDragOver,
    handleUploadDrop,
    handleDialogOpenChange,
    handleFileInputChange,
    handleSubmit,
    handleUploadDialogOpen,
  } = useSourceUploadDialogWorkflow({ onSourceUploaded });
  const fileInputId = useId();

  return (
    <Dialog
      open={isDialogOpen}
      onOpenChange={handleDialogOpenChange}
    >
      {renderTrigger ? (
        renderTrigger({
          isUploading,
          onClick: handleUploadDialogOpen,
          onDragOver: handleUploadDragOver,
          onDrop: handleUploadDrop,
        })
      ) : (
        <Button
          type="button"
          onClick={handleUploadDialogOpen}
          onDragOver={handleUploadDragOver}
          onDrop={handleUploadDrop}
          size="sm"
          className="flex w-full items-center justify-center gap-2 shadow-xs"
        >
          <Plus className="size-4" />
          Upload Document
        </Button>
      )}
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 sm:max-w-[425px]"
        onDragOver={handleUploadDragOver}
        onDrop={handleUploadDrop}
      >
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>Add source</DialogTitle>
          <DialogDescription>
            Add a document to your notebook. Notebook accepts PDF, DOC, DOCX,
            TXT, MD, XLS, XLSX, PPTX, images, and more files up to{" "}
            {MAX_UPLOAD_MB} MB.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
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
                    Max size: {MAX_UPLOAD_MB} MB
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
                onChange={handleFileInputChange}
              />
            </label>
            {message && (
              <p
                className={`mt-4 rounded-md border px-3 py-2 text-xs ${
                  message.isSuccess
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }`}
              >
                {message.text}
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
