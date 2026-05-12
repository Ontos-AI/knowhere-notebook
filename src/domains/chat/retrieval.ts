import type { RetrievalQueryParams } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

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

export function excludeDocuments(
  sources: readonly Source[],
  excludedSourceIds: readonly string[],
): Pick<RetrievalQueryParams, "excludeDocumentIds"> {
  const excluded = new Set(excludedSourceIds)
  const documentIds = sources
    .filter((source) => excluded.has(source.id))
    .map((source) => source.knowhereDocumentId)
    .filter((documentId): documentId is string => Boolean(documentId))

  return documentIds.length > 0 ? { excludeDocumentIds: documentIds } : {}
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
