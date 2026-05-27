"use client";

import {
  type ReactElement,
  useState,
} from "react";
import { Plus, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { sourcePanelState } from "@/components/source-panel-state";
import { SourceRow } from "@/components/source-row";
import { SourceUploadDialog } from "@/components/source-upload-dialog";
import type { SourceView } from "@/domains/sources/types";

export type SourcesPanelProps = {
  readonly isNarrow?: boolean;
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

export function SourcesPanel({
  isNarrow = false,
  sources = [],
  onSourceUploaded,
  selectedSourceId = null,
  onSelectSource,
  onToggleIncluded,
  onArchiveSource,
  archivingSourceIds = [],
  onLoginClick,
}: Partial<SourcesPanelProps> = {}): ReactElement {
  const [confirmSourceId, setConfirmSourceId] = useState<string | null>(null);
  const {
    archivingSourceIdSet,
    confirmSource,
    isConfirmSourceArchiving,
  } = sourcePanelState.getArchiveConfirmationState({
    archivingSourceIds,
    confirmSourceId,
    sources,
  });

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
                  if (
                    sourcePanelState.shouldCloseArchiveConfirmation(
                      confirmSourceId,
                      archivingSourceIdSet,
                    )
                  ) {
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

      <div className={`border-b border-border/70 ${isNarrow ? "p-2" : "p-4"}`}>
        {onLoginClick ? (
          <Button
            onClick={onLoginClick}
            size="sm"
            className={`flex w-full items-center justify-center gap-2 shadow-xs ${
              isNarrow ? "px-0" : ""
            }`}
            title="Log in to upload"
          >
            <Plus className="size-4" />
            {isNarrow ? null : "Log in to upload"}
          </Button>
        ) : isNarrow ? (
          <SourceUploadDialog
            onSourceUploaded={onSourceUploaded}
            renderTrigger={({ isUploading, onClick, onDragOver, onDrop }) => (
              <Button
                type="button"
                aria-label="Upload Document"
                title="Upload Document"
                onClick={onClick}
                onDragOver={onDragOver}
                onDrop={onDrop}
                size="sm"
                className="w-full px-0 shadow-xs"
                disabled={isUploading}
              >
                {isUploading ? (
                  <Spinner className="size-4" />
                ) : (
                  <Plus className="size-4" />
                )}
              </Button>
            )}
          />
        ) : (
          <SourceUploadDialog onSourceUploaded={onSourceUploaded} />
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className={isNarrow ? "px-2 py-3" : "px-4 py-4"}>
          <h3 className="mb-3 truncate text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
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
                      sourcePanelState.getNextSelectedSourceId({
                        sourceId: source.id,
                      }),
                    )
                  }
                  onToggleIncluded={onToggleIncluded}
                  onArchiveClick={
                    onArchiveSource ? setConfirmSourceId : undefined
                  }
                  isArchiving={archivingSourceIdSet.has(source.id)}
                  isNarrow={isNarrow}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function EmptySourcesState(): ReactElement {
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
