import type { KnowhereSearchRequest } from "@/agent-harness/types"

import type { Source } from "@/infrastructure/db/schema"
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

export function getRetrievalDocumentScope(
  sources: readonly Source[],
  excludedSourceIds: readonly string[],
  request: Pick<KnowhereSearchRequest, "includeDocumentIds" | "excludeDocumentIds">,
  folderScopeSourceIds?: readonly string[],
): Pick<KnowhereSearchRequest, "includeDocumentIds" | "excludeDocumentIds"> {
  const excluded = new Set(excludedSourceIds)
  const localDocumentIds = sources
    .filter((source) => excluded.has(source.id))
    .map((source) => source.knowhereDocumentId)
    .filter((documentId): documentId is string => Boolean(documentId))
  const remoteDocumentIds = excludedSourceIds
    .map((sourceId) => decodeRemoteSourceId(sourceId)?.documentId)
    .filter((documentId): documentId is string => Boolean(documentId))
  const documentIds = Array.from(
    new Set([
      ...localDocumentIds,
      ...remoteDocumentIds,
      ...(request.excludeDocumentIds ?? []),
    ]),
  )
  const includeDocumentIds = getFolderScopeDocumentIds(
    sources,
    folderScopeSourceIds,
  )

  return {
    ...(includeDocumentIds !== undefined
      ? { includeDocumentIds }
      : request.includeDocumentIds !== undefined
        ? { includeDocumentIds: [...new Set(request.includeDocumentIds)] }
        : {}),
    ...(documentIds.length > 0 ? { excludeDocumentIds: documentIds } : {}),
  }
}

function getFolderScopeDocumentIds(
  sources: readonly Source[],
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
