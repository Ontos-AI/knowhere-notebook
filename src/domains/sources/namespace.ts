import type { Source } from "@/infrastructure/db/schema"

export const sharedLibraryNamespace = "default"
export const remoteSourceIdPrefix = "knowhere-doc"

type SourceNamespace = {
  readonly namespace: string
}

export type RemoteSourceHandle = {
  readonly documentId: string
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

export function getSourceNamespace(source: Source): string {
  return getOptionalSourceNamespace(source) ?? sharedLibraryNamespace
}

export function getOptionalSourceNamespace(source: Source): string | undefined {
  const candidate = (source as Source & { readonly namespace?: unknown })
    .namespace
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined
}

export function createRemoteSourceId(handle: RemoteSourceHandle): string {
  return [
    remoteSourceIdPrefix,
    encodeURIComponent(handle.namespace),
    encodeURIComponent(handle.documentId),
  ].join(":")
}

export function parseRemoteSourceId(sourceId: string): RemoteSourceHandle | null {
  const [prefix, encodedNamespace, encodedDocumentId, ...rest] =
    sourceId.split(":")
  if (
    prefix !== remoteSourceIdPrefix ||
    !encodedNamespace ||
    !encodedDocumentId ||
    rest.length > 0
  ) {
    return null
  }

  try {
    const namespace = decodeURIComponent(encodedNamespace)
    const documentId = decodeURIComponent(encodedDocumentId)
    if (!namespace || !documentId) return null
    return { namespace, documentId }
  } catch {
    return null
  }
}
