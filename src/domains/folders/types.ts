export type FolderView = {
  readonly id: string
  readonly parentId: string | null
  readonly name: string
}

export type FolderMutationError =
  | "folder-not-found"
  | "folder-name-invalid"
  | "folder-name-conflict"
  | "folder-not-empty"
  | "folder-cycle"
  | "invalid-parent-folder"

export type FolderWriteResult<Value> =
  | {
      readonly ok: true
      readonly value: Value
    }
  | {
      readonly ok: false
      readonly error: FolderMutationError
    }
