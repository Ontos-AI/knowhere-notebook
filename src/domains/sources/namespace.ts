type SourceNamespace = {
  readonly namespace: string
}

/** The home namespace every key add creates a workspace for. */
export const defaultNamespace = "default"

/**
 * Namespaces whose documents belong to a workspace. Since a workspace is
 * bound to exactly one namespace (key-agnostic, one workspace per
 * (user, namespace)), this is always just the workspace's own namespace.
 */
export function getCompatibleNamespaces(
  workspace: SourceNamespace,
): readonly string[] {
  return workspace.namespace ? [workspace.namespace] : []
}

/** The namespace uploads and retries land in: the workspace's own one. */
export function getWorkspaceNamespace(workspace: SourceNamespace): string {
  return workspace.namespace
}
