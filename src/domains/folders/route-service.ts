import "server-only"

import { notebookRequestContext } from "@/domains/workspace/request-context"
import { routeResult, type RouteResult } from "@/lib/route-result"
import { toFolderView } from "./tree"
import type { FolderMutationError, FolderView, FolderWriteResult } from "./types"
import { folderWorkflowRuntime } from "./workflow-runtime"

type ListFoldersBody = {
  readonly folders: readonly FolderView[]
}

type FolderBody =
  | {
      readonly folder: FolderView
    }
  | {
      readonly message: string
    }

type DeleteFolderBody =
  | {
      readonly id: string
      readonly archived: true
    }
  | {
      readonly message: string
    }

type FolderRouteService = {
  readonly listFolders: () => Promise<RouteResult<ListFoldersBody>>
  readonly createFolder: (input: {
    readonly name: string
    readonly parentId: string | null
  }) => Promise<RouteResult<FolderBody>>
  readonly updateFolder: (input: {
    readonly folderId: string
    readonly name?: string
    readonly parentId?: string | null
  }) => Promise<RouteResult<FolderBody>>
  readonly deleteFolder: (input: {
    readonly folderId: string
  }) => Promise<RouteResult<DeleteFolderBody>>
}

async function listFolders(): Promise<RouteResult<ListFoldersBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const folders = await folderWorkflowRuntime.listForWorkspace(workspace.id)
  return routeResult.ok({
    folders: folders.map(toFolderView),
  })
}

async function createFolder(input: {
  readonly name: string
  readonly parentId: string | null
}): Promise<RouteResult<FolderBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const result = await folderWorkflowRuntime.createFolder(
    workspace.id,
    input.parentId,
    input.name,
  )
  return toFolderBody(result)
}

async function updateFolder(input: {
  readonly folderId: string
  readonly name?: string
  readonly parentId?: string | null
}): Promise<RouteResult<FolderBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  let current = await folderWorkflowRuntime.findInWorkspace(
    workspace.id,
    input.folderId,
  )
  if (!current) {
    return routeResult.error(404, folderErrorMessage("folder-not-found"))
  }

  if (input.name !== undefined) {
    const renamed = await folderWorkflowRuntime.renameFolder(
      workspace.id,
      input.folderId,
      input.name,
    )
    if (!renamed.ok) return toFolderBody(renamed)
    current = renamed.value
  }

  if (input.parentId !== undefined) {
    const moved = await folderWorkflowRuntime.moveFolder(
      workspace.id,
      input.folderId,
      input.parentId,
    )
    if (!moved.ok) return toFolderBody(moved)
    current = moved.value
  }

  return routeResult.ok({ folder: toFolderView(current) })
}

async function deleteFolder(input: {
  readonly folderId: string
}): Promise<RouteResult<DeleteFolderBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const result = await folderWorkflowRuntime.softDeleteFolder(
    workspace.id,
    input.folderId,
  )
  if (!result.ok) {
    return routeResult.error(
      folderErrorStatus(result.error),
      folderErrorMessage(result.error),
    )
  }

  return routeResult.ok({
    id: input.folderId,
    archived: true as const,
  })
}

function toFolderBody(
  result: FolderWriteResult<{
    readonly id: string
    readonly parentId: string | null
    readonly name: string
  }>,
): RouteResult<FolderBody> {
  if (!result.ok) {
    return routeResult.error(
      folderErrorStatus(result.error),
      folderErrorMessage(result.error),
    )
  }

  return routeResult.ok({ folder: toFolderView(result.value) })
}

function folderErrorStatus(error: FolderMutationError): number {
  switch (error) {
    case "folder-not-found":
    case "invalid-parent-folder":
      return 404
    case "folder-name-conflict":
    case "folder-not-empty":
    case "folder-cycle":
      return 409
    case "folder-name-invalid":
      return 400
  }
}

function folderErrorMessage(error: FolderMutationError): string {
  switch (error) {
    case "folder-not-found":
      return "Folder not found."
    case "folder-name-invalid":
      return "Enter a folder name up to 80 characters."
    case "folder-name-conflict":
      return "A folder with this name already exists here."
    case "folder-not-empty":
      return "Move or delete the folder contents first."
    case "folder-cycle":
      return "A folder cannot be moved into itself."
    case "invalid-parent-folder":
      return "Parent folder not found."
  }
}

export const folderRouteService: FolderRouteService = {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
}
