import "server-only"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import type { Folder } from "@/infrastructure/db/schema"
import { folderRepository } from "./repository"
import type { FolderWriteResult } from "./types"

type FolderWorkflowRuntime = {
  readonly listForWorkspace: (workspaceId: string) => Promise<Folder[]>
  readonly findInWorkspace: (
    workspaceId: string,
    folderId: string,
  ) => Promise<Folder | null>
  readonly createFolder: (
    workspaceId: string,
    parentId: string | null,
    name: string,
  ) => Promise<FolderWriteResult<Folder>>
  readonly renameFolder: (
    workspaceId: string,
    folderId: string,
    name: string,
  ) => Promise<FolderWriteResult<Folder>>
  readonly moveFolder: (
    workspaceId: string,
    folderId: string,
    parentId: string | null,
  ) => Promise<FolderWriteResult<Folder>>
  readonly softDeleteFolder: (
    workspaceId: string,
    folderId: string,
  ) => Promise<FolderWriteResult<true>>
  readonly resolveDescendantSourceIds: (
    workspaceId: string,
    folderId: string,
  ) => Promise<readonly string[]>
}

const listForWorkspace: FolderWorkflowRuntime["listForWorkspace"] = (
  workspaceId: string,
) => databaseRuntime.runPromise(folderRepository.listForWorkspaceEffect(workspaceId))

const findInWorkspace: FolderWorkflowRuntime["findInWorkspace"] = (
  workspaceId: string,
  folderId: string,
) =>
  databaseRuntime.runPromise(
    folderRepository.findInWorkspaceEffect(workspaceId, folderId),
  )

const createFolder: FolderWorkflowRuntime["createFolder"] = (
  workspaceId: string,
  parentId: string | null,
  name: string,
) =>
  databaseRuntime.runPromise(
    folderRepository.createFolderEffect(workspaceId, parentId, name),
  )

const renameFolder: FolderWorkflowRuntime["renameFolder"] = (
  workspaceId: string,
  folderId: string,
  name: string,
) =>
  databaseRuntime.runPromise(
    folderRepository.renameFolderEffect(workspaceId, folderId, name),
  )

const moveFolder: FolderWorkflowRuntime["moveFolder"] = (
  workspaceId: string,
  folderId: string,
  parentId: string | null,
) =>
  databaseRuntime.runPromise(
    folderRepository.moveFolderEffect(workspaceId, folderId, parentId),
  )

const softDeleteFolder: FolderWorkflowRuntime["softDeleteFolder"] = (
  workspaceId: string,
  folderId: string,
) =>
  databaseRuntime.runPromise(
    folderRepository.softDeleteFolderEffect(workspaceId, folderId),
  )

const resolveDescendantSourceIds: FolderWorkflowRuntime["resolveDescendantSourceIds"] =
  (workspaceId: string, folderId: string) =>
    databaseRuntime.runPromise(
      folderRepository.resolveDescendantSourceIdsEffect(workspaceId, folderId),
    )

export const folderWorkflowRuntime: FolderWorkflowRuntime = {
  listForWorkspace,
  findInWorkspace,
  createFolder,
  renameFolder,
  moveFolder,
  softDeleteFolder,
  resolveDescendantSourceIds,
}
