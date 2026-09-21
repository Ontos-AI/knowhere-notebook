"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import useSWRMutation from "swr/mutation"

import { getResolvedCurrentFolderId } from "@/components/folder-panel-state"
import type { FolderView } from "@/domains/folders/types"
import type { SourceView } from "@/domains/sources/types"
import { workspaceClient } from "@/domains/workspace/client"

type WorkspaceFolderWorkflowInput = {
  readonly initialFolders?: readonly FolderView[]
  readonly isGuest?: boolean
  readonly onSourceMoved?: (source: SourceView) => void
}

type WorkspaceFolderWorkflow = {
  readonly creatingFolder: boolean
  readonly currentFolderId: string | null
  readonly deletingFolderIds: readonly string[]
  readonly folders: FolderView[]
  readonly handleCreateFolder: (name: string) => Promise<void>
  readonly handleDeleteFolder: (folderId: string) => Promise<void>
  readonly handleMoveFolder: (
    folderId: string,
    parentId: string | null,
  ) => Promise<void>
  readonly handleMoveSource: (
    sourceId: string,
    folderId: string | null,
  ) => Promise<void>
  readonly handleOpenFolder: (folderId: string | null) => void
  readonly handleRenameFolder: (folderId: string, name: string) => Promise<void>
  readonly movingSourceIds: readonly string[]
}

const foldersSWRKey = workspaceClient.keys.folders

export function useWorkspaceFolderWorkflow({
  initialFolders = [],
  isGuest = false,
  onSourceMoved,
}: WorkspaceFolderWorkflowInput): WorkspaceFolderWorkflow {
  const initialFolderRows = useMemo(() => [...initialFolders], [initialFolders])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [deletingFolderIds, setDeletingFolderIds] = useState<string[]>([])
  const [movingSourceIds, setMovingSourceIds] = useState<string[]>([])
  const { data: serverFolders, mutate: mutateFolders } = useSWR(
    isGuest ? null : foldersSWRKey,
    workspaceClient.fetchFolders,
    {
      fallbackData: initialFolderRows,
      revalidateIfStale: false,
      revalidateOnMount: false,
    },
  )
  const folders = serverFolders ?? initialFolderRows
  const resolvedCurrentFolderId = getResolvedCurrentFolderId(
    folders,
    currentFolderId,
  )
  const { trigger: createFolder, isMutating: creatingFolder } = useSWRMutation(
    foldersSWRKey,
    createFolderMutation,
  )
  const { trigger: updateFolder } = useSWRMutation(
    foldersSWRKey,
    updateFolderMutation,
  )
  const { trigger: deleteFolder } = useSWRMutation(
    foldersSWRKey,
    deleteFolderMutation,
  )
  const { trigger: assignSourceFolder } = useSWRMutation(
    workspaceClient.keys.assignSourceFolder,
    assignSourceFolderMutation,
  )

  function handleOpenFolder(folderId: string | null): void {
    setCurrentFolderId(folderId)
  }

  async function handleCreateFolder(name: string): Promise<void> {
    const folder = await createFolder({
      name,
      parentId: resolvedCurrentFolderId,
    })
    void mutateFolders(
      (current) => [...(current ?? folders), folder],
      { revalidate: false },
    )
    void mutateFolders()
  }

  async function handleRenameFolder(
    folderId: string,
    name: string,
  ): Promise<void> {
    const folder = await updateFolder({ folderId, name })
    void mutateFolders(
      (current) => replaceFolder(current ?? folders, folder),
      { revalidate: false },
    )
  }

  async function handleMoveFolder(
    folderId: string,
    parentId: string | null,
  ): Promise<void> {
    const folder = await updateFolder({ folderId, parentId })
    void mutateFolders(
      (current) => replaceFolder(current ?? folders, folder),
      { revalidate: false },
    )
  }

  async function handleDeleteFolder(folderId: string): Promise<void> {
    setDeletingFolderIds((current) => [...current, folderId])
    try {
      await deleteFolder(folderId)
      void mutateFolders(
        (current) =>
          (current ?? folders).filter((folder) => folder.id !== folderId),
        { revalidate: false },
      )
      if (resolvedCurrentFolderId === folderId) {
        setCurrentFolderId(null)
      }
    } finally {
      setDeletingFolderIds((current) =>
        current.filter((id) => id !== folderId),
      )
    }
  }

  async function handleMoveSource(
    sourceId: string,
    folderId: string | null,
  ): Promise<void> {
    setMovingSourceIds((current) => [...current, sourceId])
    try {
      const source = await assignSourceFolder({ sourceId, folderId })
      onSourceMoved?.(source)
    } finally {
      setMovingSourceIds((current) =>
        current.filter((id) => id !== sourceId),
      )
    }
  }

  return {
    creatingFolder,
    currentFolderId: resolvedCurrentFolderId,
    deletingFolderIds,
    folders,
    handleCreateFolder,
    handleDeleteFolder,
    handleMoveFolder,
    handleMoveSource,
    handleOpenFolder,
    handleRenameFolder,
    movingSourceIds,
  }
}

function replaceFolder(
  folders: readonly FolderView[],
  nextFolder: FolderView,
): FolderView[] {
  return folders.map((folder) =>
    folder.id === nextFolder.id ? nextFolder : folder,
  )
}

function createFolderMutation(
  _key: string,
  { arg }: { readonly arg: { readonly name: string; readonly parentId: string | null } },
): Promise<FolderView> {
  return workspaceClient.createFolder(arg)
}

function updateFolderMutation(
  _key: string,
  {
    arg,
  }: {
    readonly arg: {
      readonly folderId: string
      readonly name?: string
      readonly parentId?: string | null
    }
  },
): Promise<FolderView> {
  return workspaceClient.updateFolder(arg.folderId, {
    name: arg.name,
    parentId: arg.parentId,
  })
}

function deleteFolderMutation(
  _key: string,
  { arg }: { readonly arg: string },
): Promise<void> {
  return workspaceClient.deleteFolder(arg)
}

function assignSourceFolderMutation(
  _key: string,
  {
    arg,
  }: {
    readonly arg: { readonly sourceId: string; readonly folderId: string | null }
  },
): Promise<SourceView> {
  return workspaceClient.assignSourceFolder(arg.sourceId, arg.folderId)
}
