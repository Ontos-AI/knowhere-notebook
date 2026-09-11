"use client";

import {
  type ReactElement,
  useMemo,
  useState,
} from "react";
import { BookOpen, ChevronLeft, ChevronRight, Database, FolderPlus, Plus } from "lucide-react";
import { FolderRow } from "@/components/folder-row";
import {
  getFolderBreadcrumb,
  getFolderListItems,
  type FolderListItem,
} from "@/components/folder-panel-state";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import type { FolderView } from "@/domains/folders/types";
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
  onRetrySource?: (sourceId: string) => void;
  onLibraryOpen?: () => void;
  folders?: readonly FolderView[];
  currentFolderId?: string | null;
  creatingFolder?: boolean;
  deletingFolderIds?: readonly string[];
  movingSourceIds?: readonly string[];
  onOpenFolder?: (folderId: string | null) => void;
  onCreateFolder?: (name: string) => void | Promise<void>;
  onRenameFolder?: (folderId: string, name: string) => void | Promise<void>;
  onMoveFolder?: (folderId: string, parentId: string | null) => void | Promise<void>;
  onDeleteFolder?: (folderId: string) => void | Promise<void>;
  onMoveSourceToFolder?: (sourceId: string, folderId: string | null) => void;
  onOfficialLibrarySourceAdd?: (demoSourceId: string) => void;
  archivingSourceIds?: readonly string[];
  retryingSourceIds?: readonly string[];
  analyticsContext?: AnalyticsContext;
  sourceCountSnapshot?: number;
  /** When provided, the Upload button redirects to login instead of opening the dialog. */
  onLoginClick?: () => void;
};

const sourceListPageSize = 25;

type SourcePageState = {
  readonly page: number;
  readonly selectedSourceId: string | null;
};

export function SourcesPanel({
  isNarrow = false,
  isLibraryOpen = false,
  sources = [],
  onSourceUploaded,
  selectedSourceId = null,
  onSelectSource,
  onToggleIncluded,
  onArchiveSource,
  onRetrySource,
  onLibraryOpen,
  folders = [],
  currentFolderId = null,
  creatingFolder = false,
  deletingFolderIds = [],
  movingSourceIds = [],
  onOpenFolder,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onMoveSourceToFolder,
  archivingSourceIds = [],
  retryingSourceIds = [],
  analyticsContext,
  sourceCountSnapshot = sources.length,
  onLoginClick,
}: Partial<SourcesPanelProps> = {}): ReactElement {
  const [confirmSourceId, setConfirmSourceId] = useState<string | null>(null);
  const [confirmFolderId, setConfirmFolderId] = useState<string | null>(null);
  const [folderNameDialog, setFolderNameDialog] = useState<
    | { readonly kind: "create" }
    | { readonly kind: "rename"; readonly folderId: string }
    | null
  >(null);
  const [folderName, setFolderName] = useState("");
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
  const workspaceSources = sources.filter(
    (source) => source.officialLibrary === undefined,
  );
  const folderRows = folders ?? [];
  const breadcrumb = getFolderBreadcrumb(folderRows, currentFolderId);
  const confirmFolder =
    folderRows.find((folder) => folder.id === confirmFolderId) ?? null;
  const deletingFolderIdSet = new Set(deletingFolderIds);
  const movingSourceIdSet = new Set(movingSourceIds);
  const listItems = getFolderListItems(
    folderRows,
    workspaceSources,
    currentFolderId,
  );
  const selectedSourcePage = getSelectedSourcePage(
    listItems,
    selectedSourceId,
  );
  const requestedSourcePage =
    selectedSourceId !== sourcePageState.selectedSourceId &&
    selectedSourcePage !== null
      ? selectedSourcePage
      : sourcePageState.page;
  const sourcePagination = useMemo(
    () => getSourcePagination(listItems, requestedSourcePage),
    [listItems, requestedSourcePage],
  );

  async function submitFolderName(): Promise<void> {
    const name = folderName.trim();
    if (!folderNameDialog || name.length === 0) return;
    if (folderNameDialog.kind === "create") {
      await onCreateFolder?.(name);
    } else {
      await onRenameFolder?.(folderNameDialog.folderId, name);
    }
    setFolderNameDialog(null);
    setFolderName("");
  }

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
      <AlertDialog
        open={confirmFolderId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmFolderId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmFolder
                ? `Delete "${confirmFolder.name}"? Move its contents out first.`
                : "Delete this folder? Move its contents out first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                confirmFolderId !== null &&
                deletingFolderIdSet.has(confirmFolderId)
              }
              onClick={() => {
                if (confirmFolderId) {
                  void onDeleteFolder?.(confirmFolderId);
                  setConfirmFolderId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={folderNameDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFolderNameDialog(null);
            setFolderName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {folderNameDialog?.kind === "rename"
                ? "Rename folder"
                : "New folder"}
            </DialogTitle>
          </DialogHeader>
          <Input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="Folder name"
            aria-label="Folder name"
          />
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              disabled={creatingFolder || folderName.trim().length === 0}
              onClick={() => {
                void submitFolderName();
              }}
            >
              {creatingFolder ? <Spinner className="size-3.5" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        {onCreateFolder && !onLoginClick ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`mt-2 flex w-full items-center justify-center gap-2 shadow-xs ${
              isNarrow ? "px-0" : ""
            }`}
            onClick={() => {
              setFolderName("");
              setFolderNameDialog({ kind: "create" });
            }}
            aria-label="New folder"
            title="New folder"
          >
            <FolderPlus className="size-4" />
            {isNarrow ? null : "New folder"}
          </Button>
        ) : null}
      </div>
      <ScrollArea className="flex-1">
        <div className={isNarrow ? "px-2 py-3" : "px-4 py-4"}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="truncate text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Sources
            </h3>
            <button
              type="button"
              onClick={onLibraryOpen}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/80 bg-background text-[11px] font-semibold text-foreground shadow-xs hover:bg-muted ${
                isNarrow ? "w-8 justify-center px-0" : "px-2"
              } ${
                isLibraryOpen ? "border-primary/40 bg-primary/5 text-primary" : ""
              }`}
              aria-label="Open library"
              title="Open library"
            >
              <BookOpen className="size-3.5" />
              {isNarrow ? null : "open library"}
            </button>
          </div>
          {onOpenFolder ? (
            <FolderBreadcrumb
              folders={breadcrumb}
              onOpenFolder={onOpenFolder}
            />
          ) : null}

          {listItems.length === 0 ? (
            <EmptySourcesState />
          ) : (
            <div className="flex flex-col gap-1.5">
              {sourcePagination.items.map((item) =>
                item.kind === "folder" ? (
                  <FolderRow
                    key={item.folder.id}
                    folder={item.folder}
                    folders={folderRows}
                    isDeleting={deletingFolderIdSet.has(item.folder.id)}
                    isNarrow={isNarrow}
                    onDelete={setConfirmFolderId}
                    onMove={(folderId, parentId) => {
                      void onMoveFolder?.(folderId, parentId);
                    }}
                    onOpen={(folderId) => onOpenFolder?.(folderId)}
                    onRename={(folderId) => {
                      const folder = folderRows.find(
                        (candidate) => candidate.id === folderId,
                      );
                      setFolderName(folder?.name ?? "");
                      setFolderNameDialog({ kind: "rename", folderId });
                    }}
                  />
                ) : (
                  <SourceRow
                    key={item.source.id}
                    source={item.source}
                    chunkTreeHref={getChunkTreeHref(item.source)}
                    isSelected={item.source.id === selectedSourceId}
                    onSelect={() =>
                      onSelectSource?.(
                        sourcePanelState.getNextSelectedSourceId({
                          sourceId: item.source.id,
                        }),
                      )
                    }
                    onToggleIncluded={onToggleIncluded}
                    onArchiveClick={
                      onArchiveSource ? setConfirmSourceId : undefined
                    }
                    onRetryClick={onRetrySource}
                    folders={folderRows}
                    isMoving={movingSourceIdSet.has(item.source.id)}
                    onMoveToFolder={onMoveSourceToFolder}
                    isArchiving={archivingSourceIdSet.has(item.source.id)}
                    isRetrying={retryingSourceIdSet.has(item.source.id)}
                    isNarrow={isNarrow}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </ScrollArea>
      {listItems.length > sourceListPageSize ? (
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

type SourcePagination = {
  readonly end: number;
  readonly page: number;
  readonly items: readonly FolderListItem[];
  readonly start: number;
  readonly total: number;
  readonly totalPages: number;
};

function getSourcePagination(
  items: readonly FolderListItem[],
  requestedPage: number,
): SourcePagination {
  const total = items.length;
  const totalPages = getTotalSourcePages(total);
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const startIndex = (page - 1) * sourceListPageSize;
  const endIndex = Math.min(startIndex + sourceListPageSize, total);

  return {
    end: endIndex,
    page,
    items: items.slice(startIndex, endIndex),
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
  items: readonly FolderListItem[],
  selectedSourceId: string | null,
): number | null {
  if (!selectedSourceId) return null;

  const selectedIndex = items.findIndex(
    (item) => item.kind === "source" && item.source.id === selectedSourceId,
  );
  return selectedIndex >= 0 ? getSourcePageForIndex(selectedIndex) : null;
}

function FolderBreadcrumb({
  folders,
  onOpenFolder,
}: {
  readonly folders: readonly FolderView[];
  readonly onOpenFolder: (folderId: string | null) => void;
}): ReactElement {
  return (
    <Breadcrumb className="mb-3">
      <BreadcrumbList>
        <BreadcrumbItem>
          {folders.length === 0 ? (
            <BreadcrumbPage>All sources</BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              href="#"
              onClick={(event) => {
                event.preventDefault();
                onOpenFolder(null);
              }}
            >
              All sources
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {folders.map((folder, index) => (
          <BreadcrumbItem key={folder.id}>
            <BreadcrumbSeparator />
            {index === folders.length - 1 ? (
              <BreadcrumbPage>{folder.name}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onOpenFolder(folder.id);
                }}
              >
                {folder.name}
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function getChunkTreeHref(source: SourceView): string | undefined {
  if (source.documentPresentation?.kind === "page-assets") return undefined;
  return source.documentId
    ? `/inspect/${encodeURIComponent(source.documentId)}/chunks`
    : undefined;
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
