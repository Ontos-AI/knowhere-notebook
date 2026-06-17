"use client";

import {
  type ReactElement,
  useState,
} from "react";
import { BookOpen, Plus, Database } from "lucide-react";
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
import type {
  OfficialLibrarySourceView,
  SourceView,
} from "@/domains/sources/types";
import type { AnalyticsContext } from "@/lib/posthog";

export type SourcesPanelProps = {
  readonly isNarrow?: boolean;
  readonly addingLibrarySourceIds?: readonly string[];
  readonly isLibraryOpen?: boolean;
  readonly officialLibrarySources?: readonly OfficialLibrarySourceView[];
  sources: SourceView[];
  onSourceUploaded?: (source: SourceView) => void;
  selectedSourceId?: string | null;
  onSelectSource?: (sourceId: string | null) => void;
  onToggleIncluded?: (sourceId: string, included: boolean) => void;
  onArchiveSource?: (sourceId: string) => void;
  onLibraryOpen?: () => void;
  onOfficialLibrarySourceAdd?: (demoSourceId: string) => void;
  archivingSourceIds?: readonly string[];
  analyticsContext?: AnalyticsContext;
  sourceCountSnapshot?: number;
  /** When provided, the Upload button redirects to login instead of opening the dialog. */
  onLoginClick?: () => void;
};

export function SourcesPanel({
  isNarrow = false,
  isLibraryOpen = false,
  officialLibrarySources = [],
  sources = [],
  onSourceUploaded,
  selectedSourceId = null,
  onSelectSource,
  onToggleIncluded,
  onArchiveSource,
  onLibraryOpen,
  archivingSourceIds = [],
  analyticsContext,
  sourceCountSnapshot = sources.length,
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
  const workspaceSources = sources.filter(
    (source) => source.officialLibrary === undefined,
  );
  const hasLibrarySources =
    officialLibrarySources.length > 0 ||
    sources.some((source) => source.officialLibrary !== undefined);

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
            analyticsContext={analyticsContext}
            sourceCountSnapshot={sourceCountSnapshot}
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
          <SourceUploadDialog
            onSourceUploaded={onSourceUploaded}
            analyticsContext={analyticsContext}
            sourceCountSnapshot={sourceCountSnapshot}
          />
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className={isNarrow ? "px-2 py-3" : "px-4 py-4"}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="truncate text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Sources
            </h3>
            {hasLibrarySources && !isNarrow ? (
              <button
                type="button"
                onClick={onLibraryOpen}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/80 bg-background px-2 text-[11px] font-semibold text-foreground shadow-xs hover:bg-muted ${
                  isLibraryOpen ? "border-primary/40 bg-primary/5 text-primary" : ""
                }`}
                aria-label="Open library"
              >
                <BookOpen className="size-3.5" />
                open library
              </button>
            ) : null}
          </div>

          {workspaceSources.length === 0 ? (
            <EmptySourcesState />
          ) : (
            <div className="flex flex-col gap-1.5">
              {workspaceSources.map((source) => (
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
