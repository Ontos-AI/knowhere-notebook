export const sharedLibraryNamespace = "default"

type SourceNamespace = {
  readonly namespace: string
}

export function getUploadNamespace(): string {
  return sharedLibraryNamespace
}

export function getCompatibleNamespaces(
  workspace: SourceNamespace,
): readonly string[] {
  const namespaces = [sharedLibraryNamespace]
  if (
    workspace.namespace &&
    workspace.namespace !== sharedLibraryNamespace
  ) {
    namespaces.push(workspace.namespace)
  }
  return namespaces
}
