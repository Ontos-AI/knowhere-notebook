import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import type { ChatCitationView } from "@/domains/chat/types"

export function toChatCitationViews(
  results: readonly RetrievalResult[],
  answer: string,
): ChatCitationView[] {
  const descriptionsBySourceNumber = getCitationDescriptions(answer)

  return results.map((result, index) => {
    const description = descriptionsBySourceNumber.get(index + 1)
    return {
      content: result.content,
      chunkType: result.chunkType,
      score: result.score,
      ...(result.chunkId ? { chunkId: result.chunkId } : {}),
      ...(result.assetUrl ? { assetUrl: result.assetUrl } : {}),
      ...(description ? { description } : {}),
      source: {
        documentId: result.source.documentId,
        sourceFileName: result.source.sourceFileName,
        sectionPath: result.source.sectionPath,
      },
    }
  })
}

export function useNotebookSourceTitles(
  results: readonly RetrievalResult[],
  sources: readonly Source[],
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
