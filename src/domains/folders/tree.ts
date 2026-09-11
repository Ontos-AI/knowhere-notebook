import type { SourceView } from "@/domains/sources/types"
import type { FolderView } from "./types"

export function listChildFolders(
  folders: readonly FolderView[],
  parentId: string | null,
): FolderView[] {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function getFolderPath(
  folders: readonly FolderView[],
  folderId: string | null,
): FolderView[] {
  if (!folderId) return []

  const foldersById = new Map(folders.map((folder) => [folder.id, folder]))
  const path: FolderView[] = []
  const seen = new Set<string>()
  let current = foldersById.get(folderId)

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId
      ? foldersById.get(current.parentId)
      : undefined
  }

  return path
}

export function getDescendantFolderIds(
  folders: readonly FolderView[],
  folderId: string,
): readonly string[] {
  const childrenByParent = new Map<string | null, FolderView[]>()
  for (const folder of folders) {
    const siblings = childrenByParent.get(folder.parentId) ?? []
    siblings.push(folder)
    childrenByParent.set(folder.parentId, siblings)
  }

  const folderIds: string[] = []
  const stack = [folderId]
  while (stack.length > 0) {
    const currentId = stack.pop()
    if (!currentId) continue
    folderIds.push(currentId)
    for (const child of childrenByParent.get(currentId) ?? []) {
      stack.push(child.id)
    }
  }

  return folderIds
}

export function listSourcesInFolder(
  sources: readonly SourceView[],
  folderId: string | null,
): SourceView[] {
  return sources.filter((source) => (source.folderId ?? null) === folderId)
}

export function listFolderScopeSourceIds(
  sources: readonly SourceView[],
  folders: readonly FolderView[],
  folderId: string,
): readonly string[] {
  const folderIds = new Set(getDescendantFolderIds(folders, folderId))
  return sources
    .filter((source) => source.folderId !== undefined && folderIds.has(source.folderId))
    .map((source) => source.id)
}

export function canAssignSourceToFolder(source: SourceView): boolean {
  return (
    source.kind !== "remote" &&
    source.officialLibrary === undefined &&
    source.demoSourceId === undefined
  )
}

export function toFolderView(folder: {
  readonly id: string
  readonly parentId: string | null
  readonly name: string
}): FolderView {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
  }
}
