"use client"

import type { ReactElement } from "react"
import { Folder, MoreHorizontal, Pencil, Trash2 } from "lucide-react"

import { FolderDestinationMenu } from "@/components/folder-destination-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { getDescendantFolderIds } from "@/domains/folders/tree"
import type { FolderView } from "@/domains/folders/types"

export type FolderRowProps = {
  readonly folder: FolderView
  readonly folders: readonly FolderView[]
  readonly isDeleting?: boolean
  readonly isNarrow?: boolean
  readonly onDelete: (folderId: string) => void
  readonly onMove: (folderId: string, parentId: string | null) => void
  readonly onOpen: (folderId: string) => void
  readonly onRename: (folderId: string) => void
}

export function FolderRow({
  folder,
  folders,
  isDeleting = false,
  isNarrow = false,
  onDelete,
  onMove,
  onOpen,
  onRename,
}: FolderRowProps): ReactElement {
  const excludedFolderIds = new Set(getDescendantFolderIds(folders, folder.id))

  return (
    <div
      data-testid="folder-row"
      className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center text-left transition-colors ${
        isNarrow ? "gap-1.5 rounded-lg p-1.5" : "gap-2 rounded-lg p-2"
      } border border-border/70 bg-background hover:bg-muted/40`}
    >
      <button
        type="button"
        onClick={() => onOpen(folder.id)}
        disabled={isDeleting}
        className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center text-left ${
          isNarrow ? "gap-1.5" : "gap-2"
        }`}
        aria-label={`Open folder ${folder.name}`}
      >
        <div
          className={`flex shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 ${
            isNarrow ? "size-7" : "size-8"
          }`}
        >
          <Folder className="size-4" />
        </div>
        <div className="min-w-0 overflow-hidden">
          <p className="truncate text-sm font-medium text-foreground">
            {folder.name}
          </p>
          <p className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Folder
          </p>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isDeleting}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-70"
            aria-label={`Folder actions for ${folder.name}`}
          >
            {isDeleting ? (
              <Spinner className="size-3.5" />
            ) : (
              <MoreHorizontal className="size-3.5" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onRename(folder.id)}>
            <Pencil className="size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <FolderDestinationMenu
                folders={folders}
                excludedFolderIds={excludedFolderIds}
                onSelect={(parentId) => onMove(folder.id, parentId)}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onDelete(folder.id)}>
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
