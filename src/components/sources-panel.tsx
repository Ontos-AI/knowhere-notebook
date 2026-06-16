"use client";

import {
  type ReactElement,
  useState,
} from "react";
import { Plus, Database, FileText } from "lucide-react";
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

export type SourcesPanelProps = {
  readonly isNarrow?: boolean;
  readonly addingLibrarySourceIds?: readonly string[];
  readonly officialLibrarySources?: readonly OfficialLibrarySourceView[];
  sources: SourceView[];
  onSourceUploaded?: (source: SourceView) => void;
  selectedSourceId?: string | null;
  onSelectSource?: (sourceId: string | null) => void;
  onToggleIncluded?: (sourceId: string, included: boolean) => void;
  onArchiveSource?: (sourceId: string) => void;
  onOfficialLibrarySourceAdd?: (demoSourceId: string) => void;
  archivingSourceIds?: readonly string[];
  /** When provided, the Upload button redirects to login instead of opening the dialog. */
  onLoginClick?: () => void;
};

export function SourcesPanel({
  isNarrow = false,
  addingLibrarySourceIds = [],
  officialLibrarySources = [],
  sources = [],
  onSourceUploaded,
  selectedSourceId = null,
  onSelectSource,
  onToggleIncluded,
  onArchiveSource,
  onOfficialLibrarySourceAdd,
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
  const librarySources = sources.filter(
    (source) => source.officialLibrary !== undefined,
  );
  const workspaceSources = sources.filter(
    (source) => source.officialLibrary === undefined,
  );
  const visibleLibrarySourceIds = new Set(
    librarySources.flatMap((source) =>
      source.officialLibrary?.librarySourceId
        ? [source.officialLibrary.librarySourceId]
        : [],
    ),
  );
  const plannedLibrarySources = officialLibrarySources.filter(
    (source) =>
      source.status !== "ready" &&
      !visibleLibrarySourceIds.has(source.librarySourceId),
  );
  const addingLibrarySourceIdSet = new Set(addingLibrarySourceIds);

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
          {(librarySources.length > 0 || plannedLibrarySources.length > 0) && (
            <section className="mb-5">
              <h3 className="mb-3 truncate text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Official Library
              </h3>
              <div className="flex flex-col gap-1.5">
                {librarySources.map((source) => (
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
                    onAddClick={
                      onLoginClick ? () => onLoginClick() : onOfficialLibrarySourceAdd
                    }
                    isAdding={addingLibrarySourceIdSet.has(
                      source.demoSourceId ?? source.id,
                    )}
                    isArchiving={false}
                    isNarrow={isNarrow}
                  />
                ))}
                {plannedLibrarySources.map((source) => (
                  <PlannedLibraryRow
                    key={source.librarySourceId}
                    source={source}
                    isNarrow={isNarrow}
                  />
                ))}
              </div>
            </section>
          )}

          <h3 className="mb-3 truncate text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Sources
          </h3>

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

function PlannedLibraryRow({
  source,
  isNarrow,
}: {
  readonly source: OfficialLibrarySourceView;
  readonly isNarrow: boolean;
}): ReactElement {
  return (
    <div
      data-testid="official-library-planned-row"
      className={`grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center border border-dashed border-border/70 bg-muted/20 text-left opacity-80 ${
        isNarrow ? "gap-1.5 rounded-lg p-1.5" : "gap-2 rounded-lg p-2"
      }`}
    >
      <div
        className={`flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ${
          isNarrow ? "size-7" : "size-8"
        }`}
      >
        <FileText className="size-4" />
      </div>
      <div className="min-w-0 overflow-hidden">
        <p className="truncate text-sm font-medium text-foreground">
          {source.title}
        </p>
        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {source.categoryLabel} · Preparing
        </p>
      </div>
      <span className="justify-self-end rounded-md border border-border/70 px-2 py-1 text-[11px] font-semibold text-muted-foreground">
        {isNarrow ? "Soon" : "Coming"}
      </span>
    </div>
  );
}
