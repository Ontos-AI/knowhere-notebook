import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type { ChatSource } from "./contracts"
import type { ChatCitationView } from "@/domains/chat/types"
import {
  resolvePageCitationPageNumber,
  type PageCitationAssetRetrievalResult,
} from "./page-citation-assets"

export function toChatCitationViews(
  results: readonly PageCitationAssetRetrievalResult[],
  answer: string,
): ChatCitationView[] {
  const descriptionsBySourceNumber = getCitationDescriptions(answer)

  return results.map((result, index) => {
    const description = descriptionsBySourceNumber.get(index + 1)
    const pageCitationPageNumber = resolvePageCitationPageNumber(result)
    return {
      content: result.content,
      chunkType: result.chunkType,
      score: result.score,
      ...(result.chunkId ? { chunkId: result.chunkId } : {}),
      ...(result.chunkRowId ? { chunkRowId: result.chunkRowId } : {}),
      ...(result.assetUrl ? { assetUrl: result.assetUrl } : {}),
      ...(result.pageCitationAssetUrl
        ? { pageCitationAssetUrl: result.pageCitationAssetUrl }
        : {}),
      ...(pageCitationPageNumber
        ? { pageCitationPageNumber }
        : {}),
      ...(description ? { description } : {}),
      ...(result.highlightRegions && result.highlightRegions.length > 0
        ? { highlightRegions: result.highlightRegions }
        : {}),
      source: {
        documentId: result.source.documentId,
        ...(getProvenanceString(result.source.namespace ?? result.metadata?.namespace) ? { namespace: getProvenanceString(result.source.namespace ?? result.metadata?.namespace) } : {}),
        ...(getProvenanceString(result.source.jobResultId ?? result.metadata?.jobResultId) ? { jobResultId: getProvenanceString(result.source.jobResultId ?? result.metadata?.jobResultId) } : {}),
        sourceFileName: result.source.sourceFileName,
        sectionPath: result.source.sectionPath,
      },
    }
  })
}

export function useNotebookSourceTitles(
  results: readonly RetrievalResult[],
  sources: readonly ChatSource[],
): RetrievalResult[] {
  const sourceTitlesByDocumentId = new Map(
    sources.flatMap((source): readonly [string, string][] =>
      source.knowhereDocumentId
        ? [[source.knowhereDocumentId, source.title]]
        : [],
    ),
  )

  return results.map((result): RetrievalResult => {
    const documentId = result.source.documentId
    const sourceTitle = documentId
      ? sourceTitlesByDocumentId.get(documentId)
      : undefined
    if (!sourceTitle) return result

    return {
      ...result,
      source: {
        ...result.source,
        sourceFileName: sourceTitle,
      },
    }
  })
}

function getCitationDescriptions(answer: string): Map<number, string> {
  const descriptions = new Map<number, string>()
  const citationPattern = /\[Source\s+(\d+)\s*:\s*([^\]]+)\]/gi
  let match: RegExpExecArray | null

  while ((match = citationPattern.exec(answer)) !== null) {
    const sourceNumber = Number(match[1])
    const description = match[2]?.trim()

    if (
      Number.isSafeInteger(sourceNumber) &&
      sourceNumber > 0 &&
      description &&
      !descriptions.has(sourceNumber)
    ) {
      descriptions.set(sourceNumber, description)
    }
  }

  return descriptions
}

function getProvenanceString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}
