"use client";

import {
  type ReactElement,
  useMemo,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, Database, KeyRound, Plus } from "lucide-react";
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
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { sourcePanelState } from "@/components/source-panel-state";
import { SourceRow } from "@/components/source-row";
import { SourceUploadDialog } from "@/components/source-upload-dialog";
import type { SourceView } from "@/domains/sources/types";
import type { AnalyticsContext } from "@/lib/posthog";

export type SourcesPanelProps = {
  readonly isNarrow?: boolean;
  sources: SourceView[];
  activeWorkspace?: {
    readonly id: string;
    readonly namespace: string;
    readonly activeKeyLabel?: string | null;
  };
  workspaces?: readonly {
    readonly id: string;
    readonly namespace: string;
    readonly activeKeyLabel?: string | null;
  }[];
  knowhereKeyLabels?: readonly {
    readonly id: string
    readonly label: string
    readonly mask: string
  }[];
  isBlobConfigured?: boolean;
  userName?: string;
  onSourceUploaded?: (source: SourceView) => void;
  selectedSourceId?: string | null;
  onSelectSource?: (sourceId: string | null) => void;
  onToggleIncluded?: (sourceId: string, included: boolean) => void;
  onArchiveSource?: (sourceId: string) => void;
  onRetrySource?: (sourceId: string) => void;
  onOpenChunksOverlay?: (sourceId: string) => void;
  archivingSourceIds?: readonly string[];
  retryingSourceIds?: readonly string[];
  analyticsContext?: AnalyticsContext;
  sourceCountSnapshot?: number;
};

const sourceListPageSize = 25;

type SourcePageState = {
  readonly page: number;
  readonly selectedSourceId: string | null;
};

export function SourcesPanel({
  isNarrow = false,
  sources = [],
  activeWorkspace,
  workspaces = [],
  knowhereKeyLabels = [],
  isBlobConfigured = true,
  userName,
  onSourceUploaded,
  selectedSourceId = null,
  onSelectSource,
  onToggleIncluded,
  onArchiveSource,
  onRetrySource,
  onOpenChunksOverlay,
  archivingSourceIds = [],
  retryingSourceIds = [],
  analyticsContext,
  sourceCountSnapshot = sources.length,
}: Partial<SourcesPanelProps> = {}): ReactElement {
  const [confirmSourceId, setConfirmSourceId] = useState<string | null>(null);
  const [sourcePageState, setSourcePageState] = useState<SourcePageState>({
    page: 1,
    selectedSourceId: null,
  });
  const {
    archivingSourceIdSet,
    confirmSource,
    isConfirmSourceArchiving,
  } = sourcePanelState.getArchiveConfirmationState({
    archivingSourceIds,
    confirmSourceId,
    sources,
  });
  const retryingSourceIdSet = new Set(retryingSourceIds);
  const workspaceSources = sources;
  const selectedSourcePage = getSelectedSourcePage(
    workspaceSources,
    selectedSourceId,
  );
  const requestedSourcePage =
    selectedSourceId !== sourcePageState.selectedSourceId &&
    selectedSourcePage !== null
      ? selectedSourcePage
      : sourcePageState.page;
  const sourcePagination = useMemo(
    () => getSourcePagination(workspaceSources, requestedSourcePage),
    [requestedSourcePage, workspaceSources],
  );

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
        {isNarrow ? (
          <SourceUploadDialog
            onSourceUploaded={onSourceUploaded}
            analyticsContext={analyticsContext}
            sourceCountSnapshot={sourceCountSnapshot}
            isBlobConfigured={isBlobConfigured}
            activeWorkspace={activeWorkspace}
            workspaces={workspaces}
            knowhereKeyLabels={knowhereKeyLabels}
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
            isBlobConfigured={isBlobConfigured}
            activeWorkspace={activeWorkspace}
            workspaces={workspaces}
            knowhereKeyLabels={knowhereKeyLabels}
          />
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className={isNarrow ? "px-2 py-3" : "px-4 py-4"}>
          {!isNarrow ? (
            <div className="mb-3">
              <WorkspaceSwitcher
                activeWorkspace={activeWorkspace}
                knowhereKeyLabels={knowhereKeyLabels}
                userName={userName}
                workspaces={workspaces}
              />
            </div>
          ) : null}
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="truncate text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Sources
            </h3>
          </div>

          {!activeWorkspace ? (
            <EmptySetupState
              hasApiKeys={knowhereKeyLabels.length > 0}
              userName={userName}
            />
          ) : workspaceSources.length === 0 ? (
            <EmptySourcesState />
          ) : (
            <div className="flex flex-col gap-1.5">
              {sourcePagination.sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  onTreeClick={
                    onOpenChunksOverlay
                      ? () => onOpenChunksOverlay(source.id)
                      : undefined
                  }
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
                  onRetryClick={onRetrySource}
                  isArchiving={archivingSourceIdSet.has(source.id)}
                  isRetrying={retryingSourceIdSet.has(source.id)}
                  isNarrow={isNarrow}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
      {workspaceSources.length > sourceListPageSize ? (
        <SourcePaginationControls
          end={sourcePagination.end}
          isNarrow={isNarrow}
          page={sourcePagination.page}
          total={sourcePagination.total}
          totalPages={sourcePagination.totalPages}
          onNext={() =>
            setSourcePageState({
              page: Math.min(
                sourcePagination.page + 1,
                sourcePagination.totalPages,
              ),
              selectedSourceId,
            })
          }
          onPrevious={() =>
            setSourcePageState({
              page: Math.max(sourcePagination.page - 1, 1),
              selectedSourceId,
            })
          }
          start={sourcePagination.start}
        />
      ) : null}
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

function EmptySetupState({
  hasApiKeys,
  userName,
}: {
  readonly hasApiKeys: boolean;
  readonly userName?: string;
}): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <KeyRound className="size-5" />
      </div>
      <p className="text-xs font-semibold text-foreground">
        {hasApiKeys
          ? "Pick a namespace to get started"
          : `${userName ? `${userName}, a` : "A"}dd an API key to get started`}
      </p>
      <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">
        {hasApiKeys
          ? "Choose a namespace from the dropdown above to open its documents."
          : "Your API key connects a Knowhere domain. A default workspace is created automatically."}
      </p>
    </div>
  );
}

type SourcePagination = {
  readonly end: number;
  readonly page: number;
  readonly sources: readonly SourceView[];
  readonly start: number;
  readonly total: number;
  readonly totalPages: number;
};

function getSourcePagination(
  sources: readonly SourceView[],
  requestedPage: number,
): SourcePagination {
  const total = sources.length;
  const totalPages = getTotalSourcePages(total);
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const startIndex = (page - 1) * sourceListPageSize;
  const endIndex = Math.min(startIndex + sourceListPageSize, total);

  return {
    end: endIndex,
    page,
    sources: sources.slice(startIndex, endIndex),
    start: total === 0 ? 0 : startIndex + 1,
    total,
    totalPages,
  };
}

function getTotalSourcePages(sourceCount: number): number {
  return Math.max(1, Math.ceil(sourceCount / sourceListPageSize));
}

function getSourcePageForIndex(sourceIndex: number): number {
  return Math.floor(sourceIndex / sourceListPageSize) + 1;
}

function getSelectedSourcePage(
  sources: readonly SourceView[],
  selectedSourceId: string | null,
): number | null {
  if (!selectedSourceId) return null;

  const selectedIndex = sources.findIndex(
    (source) => source.id === selectedSourceId,
  );
  return selectedIndex >= 0 ? getSourcePageForIndex(selectedIndex) : null;
}

function SourcePaginationControls({
  end,
  isNarrow,
  onNext,
  onPrevious,
  page,
  start,
  total,
  totalPages,
}: {
  readonly end: number;
  readonly isNarrow: boolean;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly page: number;
  readonly start: number;
  readonly total: number;
  readonly totalPages: number;
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
      <span className="min-w-0 truncate" aria-live="polite">
        {isNarrow ? `${page}/${totalPages}` : `${start}-${end} of ${total}`}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="Previous sources page"
          title="Previous sources page"
          disabled={page <= 1}
          onClick={onPrevious}
          className="inline-flex size-7 items-center justify-center rounded-md border border-border/80 bg-background text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Next sources page"
          title="Next sources page"
          disabled={page >= totalPages}
          onClick={onNext}
          className="inline-flex size-7 items-center justify-center rounded-md border border-border/80 bg-background text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
