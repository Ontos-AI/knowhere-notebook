"use client";

import {
  type DragEvent,
  useId,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Plus, Upload } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useSourceUploadDialogWorkflow } from "@/components/source-upload-dialog-workflow";
import { workspaceClient } from "@/domains/workspace/client";
import type { SourceView } from "@/domains/sources/types";
import { MAX_UPLOAD_MB } from "@/domains/sources/validation";
import {
  trackNotebookUploadButtonClicked,
  type AnalyticsContext,
} from "@/lib/posthog";

export type SourceUploadDialogProps = {
  readonly onSourceUploaded?: (source: SourceView) => void;
  readonly analyticsContext?: AnalyticsContext;
  readonly sourceCountSnapshot?: number;
  readonly isBlobConfigured?: boolean;
  readonly activeWorkspace?: {
    readonly id: string;
    readonly namespace: string;
    readonly activeKeyLabel?: string | null;
  };
  readonly workspaces?: readonly {
    readonly id: string;
    readonly namespace: string;
  }[];
  readonly knowhereKeyLabels?: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly renderTrigger?: (props: SourceUploadDialogTriggerProps) => ReactElement;
};

export type SourceUploadDialogTriggerProps = {
  readonly isUploading: boolean;
  readonly onClick: () => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
};

type UploadTargetOption = {
  readonly keyId: string;
  readonly keyLabel: string;
  readonly namespace: string;
  readonly workspaceId?: string;
};

export function SourceUploadDialog({
  onSourceUploaded,
  analyticsContext,
  sourceCountSnapshot = 0,
  isBlobConfigured = true,
  activeWorkspace,
  workspaces = [],
  knowhereKeyLabels = [],
  renderTrigger,
}: SourceUploadDialogProps): ReactElement {
  const [selectedTargetValue, setSelectedTargetValue] = useState<string | null>(
    null,
  );
  const { data: keyNamespacesByKeyId, isLoading: isLoadingNamespaces } = useSWR(
    knowhereKeyLabels.length > 0
      ? ["upload-all-key-namespaces", knowhereKeyLabels.map((k) => k.id).join(",")]
      : null,
    async ([, ids]: readonly [string, string]) => {
      const results = await Promise.all(
        ids
          .split(",")
          .map(async (keyId) => ({
            keyId,
            namespaces: await workspaceClient.fetchApiKeyNamespaces(keyId),
          })),
      )
      return Object.fromEntries(
        results.map((entry) => [entry.keyId, entry.namespaces]),
      )
    },
    { revalidateOnFocus: false },
  );
  const workspaceIdByNamespace = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.namespace, workspace.id])),
    [workspaces],
  );

  const uploadTargetOptions = useMemo<readonly UploadTargetOption[]>(
    () =>
      knowhereKeyLabels.flatMap((key) => {
        const namespaces = keyNamespacesByKeyId?.[key.id] ?? []
        return namespaces.map((ns) => ({
          keyId: key.id,
          keyLabel: key.label,
          namespace: ns.namespace,
          workspaceId: workspaceIdByNamespace.get(ns.namespace),
        }))
      }),
    [keyNamespacesByKeyId, knowhereKeyLabels, workspaceIdByNamespace],
  );
  const defaultTargetValue = useMemo(() => {
    const option = uploadTargetOptions.find(
      (target) => target.workspaceId === activeWorkspace?.id,
    )
    return option
      ? getTargetValue(option)
      : uploadTargetOptions[0]
        ? getTargetValue(uploadTargetOptions[0])
        : null
  }, [activeWorkspace?.id, uploadTargetOptions]);
  const selectedTargetValueResolved =
    selectedTargetValue ?? defaultTargetValue;
  const selectedTarget = uploadTargetOptions.find(
    (target) => getTargetValue(target) === selectedTargetValueResolved,
  )
  const hasTargetOptions = uploadTargetOptions.length > 0;

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
  } = useSourceUploadDialogWorkflow({
    onSourceUploaded,
    analyticsContext,
    sourceCountBefore: sourceCountSnapshot,
    isBlobConfigured,
    resolveUploadTarget: async () => {
      if (!selectedTarget) return activeWorkspace?.id
      if (selectedTarget.workspaceId) return selectedTarget.workspaceId
      // Namespace exists on the key but has no workspace yet: create it
      // (same as picking it in the workspace dropdown), then upload there.
      try {
        const created = await workspaceClient.createWorkspace(
          selectedTarget.keyId,
          selectedTarget.namespace,
        )
        return created.id
      } catch {
        return undefined
      }
    },
  });
  const fileInputId = useId();
  const handleOpenUploadDialog = (): void => {
    void trackNotebookUploadButtonClicked({
      context: analyticsContext,
      sourceCountSnapshot,
    });
    handleUploadDialogOpen();
  };

  return (
    <Dialog
      open={isDialogOpen}
      onOpenChange={handleDialogOpenChange}
    >
      {renderTrigger ? (
        renderTrigger({
          isUploading,
          onClick: handleOpenUploadDialog,
          onDragOver: handleUploadDragOver,
          onDrop: handleUploadDrop,
        })
      ) : (
        <Button
          type="button"
          onClick={handleOpenUploadDialog}
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
            {hasTargetOptions ? (
              <div className="mb-4 grid gap-1.5">
                <Label htmlFor="upload-target-namespace">
                  Upload to namespace
                </Label>
                <select
                  id="upload-target-namespace"
                  data-testid="upload-target-namespace"
                  value={selectedTargetValueResolved ?? ""}
                  disabled={isUploading || isLoadingNamespaces}
                  onChange={(event) => setSelectedTargetValue(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {isLoadingNamespaces ? (
                    <option value="">Loading namespaces…</option>
                  ) : (
                    uploadTargetOptions.map((target) => (
                      <option key={getTargetValue(target)} value={getTargetValue(target)}>
                        {target.keyLabel} / {target.namespace}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : null}
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

function getTargetValue(target: UploadTargetOption): string {
  return `${target.keyId}::${target.namespace}`;
}
