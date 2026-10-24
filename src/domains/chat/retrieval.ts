import type { KnowhereSearchRequest } from "@/agent-harness/types"

import type { ChatSource } from "./contracts"
import { decodeRemoteSourceId } from "@/domains/sources/remote-library"

const RETRIEVAL_QUERY_CHAR_LIMIT = 600

export function normalizeRetrievalQuery(value: string, fallback: string): string {
  const firstContentLine = value
    .trim()
    .split(/\r?\n/)
    .map((line): string =>
      line
        .replace(/^\s*(?:retrieval\s+query|search\s+query|query)\s*:\s*/i, "")
        .trim(),
    )
    .find((line): boolean => line.length > 0)
  const withoutQuotes = stripWrappingQuotes(firstContentLine ?? "")
  const normalized = withoutQuotes.replace(/\s+/g, " ").trim()
  if (normalized.length === 0) return fallback
  return normalized.slice(0, RETRIEVAL_QUERY_CHAR_LIMIT)
}

export const emptyFolderSearchMessage =
  "The current folder has no documents. Do not call knowhere_search."

export function isEmptyFolderScope(
  folderScopeSourceIds: readonly string[] | undefined,
  sources: readonly ChatSource[],
): boolean {
  if (folderScopeSourceIds === undefined) return false
  const scoped = new Set(folderScopeSourceIds)
  return !sources.some(
    (source) => !source.demoKey && scoped.has(source.id) && Boolean(source.knowhereDocumentId),
  )
}

export function getRetrievalDocumentScope(
  sources: readonly ChatSource[],
  excludedSourceIds: readonly string[],
  request: Pick<KnowhereSearchRequest, "includeDocumentIds" | "excludeDocumentIds">,
  folderScopeSourceIds?: readonly string[],
  namespace?: string,
  excludedWorkspaceDemoDocumentIds: readonly string[] = [],
): Pick<KnowhereSearchRequest, "includeDocumentIds" | "excludeDocumentIds"> {
  const excluded = new Set(excludedSourceIds)
  if (namespace === "__knowhere_demo__") {
    if (folderScopeSourceIds !== undefined) return { includeDocumentIds: [] }
    const requested: ReadonlySet<string> | undefined = request.includeDocumentIds === undefined
      ? undefined : new Set(request.includeDocumentIds)
    const excludedDocuments: ReadonlySet<string> = new Set(request.excludeDocumentIds ?? [])
    return {
      includeDocumentIds: [...new Set(sources.flatMap((source): string[] => {
        const documentId: string | null = source.knowhereDocumentId
        if (source.namespace !== namespace || source.status !== "ready" || !documentId ||
          excluded.has(source.id) || excludedDocuments.has(documentId) || (requested && !requested.has(documentId))) return []
        return [documentId]
      }))],
    }
  }
  const localDocumentIds = sources
    .filter((source) => source.namespace !== "__knowhere_demo__" && (excluded.has(source.id) || Boolean(source.demoKey)))
    .map((source) => source.knowhereDocumentId)
    .filter((documentId): documentId is string => Boolean(documentId))
  const remoteDocumentIds = excludedSourceIds
    .map((sourceId) => decodeRemoteSourceId(sourceId)?.documentId)
    .filter((documentId): documentId is string => Boolean(documentId))
  const documentIds = Array.from(
    new Set([
      ...localDocumentIds,
      ...excludedWorkspaceDemoDocumentIds,
      ...remoteDocumentIds,
      ...(request.excludeDocumentIds ?? []),
    ]),
  )
  const folderDocumentIds = getFolderScopeDocumentIds(
    sources.filter((source) => !source.demoKey),
    folderScopeSourceIds,
  )

  const sharedDocumentIds: ReadonlySet<string> = new Set(sources.flatMap((source) => source.namespace === "__knowhere_demo__" && source.knowhereDocumentId ? [source.knowhereDocumentId] : []))
  const requestedDocumentIds: readonly string[] | undefined = request.includeDocumentIds?.filter((documentId) =>
    !sharedDocumentIds.has(documentId) && !excludedWorkspaceDemoDocumentIds.includes(documentId) &&
    !sources.some((source) => source.demoKey && source.namespace !== "__knowhere_demo__" && source.knowhereDocumentId === documentId))
  const includeDocumentIds: readonly string[] | undefined = folderDocumentIds !== undefined
    ? folderDocumentIds.filter((documentId) => requestedDocumentIds === undefined || requestedDocumentIds.includes(documentId))
    : requestedDocumentIds
  return {
    ...(includeDocumentIds !== undefined
      ? { includeDocumentIds: [...new Set(includeDocumentIds)] }
      : request.includeDocumentIds !== undefined
        ? { includeDocumentIds: [...new Set(request.includeDocumentIds)] }
        : {}),
    ...(documentIds.length > 0 ? { excludeDocumentIds: documentIds } : {}),
  }
}

function getFolderScopeDocumentIds(
  sources: readonly ChatSource[],
  folderScopeSourceIds: readonly string[] | undefined,
): string[] | undefined {
  if (folderScopeSourceIds === undefined) return undefined

  const scoped = new Set(folderScopeSourceIds)
  return [
    ...new Set(
      sources
        .filter((source) => scoped.has(source.id))
        .map((source) => source.knowhereDocumentId)
        .filter((documentId): documentId is string => Boolean(documentId)),
    ),
  ]
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim()
  }
  return value
}
