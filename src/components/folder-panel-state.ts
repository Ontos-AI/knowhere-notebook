import {
  getFolderPath,
  listChildFolders,
  listSourcesInFolder,
} from "@/domains/folders/tree"
import type { FolderView } from "@/domains/folders/types"
import type { SourceView } from "@/domains/sources/types"

export type FolderListItem =
  | {
      readonly kind: "folder"
      readonly folder: FolderView
    }
  | {
      readonly kind: "source"
      readonly source: SourceView
    }

export function getFolderListItems(
  folders: readonly FolderView[],
  sources: readonly SourceView[],
  currentFolderId: string | null,
): FolderListItem[] {
  return [
    ...listChildFolders(folders, currentFolderId).map(
      (folder): FolderListItem => ({ kind: "folder", folder }),
    ),
    ...listSourcesInFolder(sources, currentFolderId).map(
      (source): FolderListItem => ({ kind: "source", source }),
    ),
  ]
}

export function getResolvedCurrentFolderId(
  folders: readonly FolderView[],
  currentFolderId: string | null,
): string | null {
  if (!currentFolderId) return null
  return folders.some((folder) => folder.id === currentFolderId)
    ? currentFolderId
    : null
}

export function getFolderBreadcrumb(
  folders: readonly FolderView[],
  currentFolderId: string | null,
): FolderView[] {
  return getFolderPath(folders, currentFolderId)
}
