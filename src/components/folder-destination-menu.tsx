"use client"

import type { ReactElement } from "react"
import { Folder } from "lucide-react"

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { getFolderPath } from "@/domains/folders/tree"
import type { FolderView } from "@/domains/folders/types"

export type FolderDestinationMenuProps = {
  readonly folders: readonly FolderView[]
  readonly excludedFolderIds?: ReadonlySet<string>
  readonly onSelect: (folderId: string | null) => void
}

export function FolderDestinationMenu({
  folders,
  excludedFolderIds,
  onSelect,
}: FolderDestinationMenuProps): ReactElement {
  const destinations = folders.filter(
    (folder) => !excludedFolderIds?.has(folder.id),
  )

  return (
    <>
      <DropdownMenuLabel>Move to</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => onSelect(null)}>
        All sources
      </DropdownMenuItem>
      {destinations.length > 0 ? <DropdownMenuSeparator /> : null}
      {destinations.map((folder) => (
        <DropdownMenuItem
          key={folder.id}
          onSelect={() => onSelect(folder.id)}
        >
          <Folder className="size-3.5" />
          {formatFolderDestination(folders, folder.id)}
        </DropdownMenuItem>
      ))}
    </>
  )
}

function formatFolderDestination(
  folders: readonly FolderView[],
  folderId: string,
): string {
  return getFolderPath(folders, folderId)
    .map((folder) => folder.name)
    .join(" / ")
}
