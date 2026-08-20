import { parsedChunkNormalization } from "@/domains/chunks/normalization"
import type { ChatMessageView } from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import { demoOriginalFile } from "@/domains/demo/original-file"
import type { SourceView } from "@/domains/sources/types"
import type {
  DemoCatalog,
  DemoChunk,
  DemoSource,
} from "@/integrations/knowhere-demo"

export const demoView = {
  toChatMessages,
  toParsedChunkView,
  toSourceView,
} as const

function toSourceView(source: DemoSource): SourceView {
  const originalFile = demoOriginalFile.toSourceOriginalFileView(source)

  return {
    id: source.demoSourceId,
    kind: "demo",
    demoSourceId: source.demoSourceId,
    title: source.title,
    mimeType: source.mimeType,
    status: "ready",
    documentId: source.canonicalDocumentId,
    ...(originalFile ? { originalFile } : {}),
    ...(source.officialLibrary
      ? {
          officialLibrary: {
            librarySourceId: source.officialLibrary.librarySourceId,
            categoryId: source.officialLibrary.categoryId,
            sourceUrl: source.officialLibrary.sourceUrl,
          },
        }
      : {}),
    chunkCount: source.chunkCount,
  }
}

function toChatMessages(catalog: DemoCatalog): ChatMessageView[] {
  return catalog.sources.flatMap((source) =>
    source.examples.flatMap((example): ChatMessageView[] => [
      {
        id: `${example.id}-user`,
        role: "user",
        content: example.question,
      },
      {
        id: `${example.id}-assistant`,
        role: "assistant",
        content: withCitationMarkers(example.answer, example.citations.length),
        citations: example.citations.map((citation) => ({
          chunkType: citation.chunkType,
          score: 0.95,
          content: citation.content,
          ...(citation.description
            ? { description: citation.description }
            : {}),
          ...(citation.pageCitationPageNumber
            ? { pageCitationPageNumber: citation.pageCitationPageNumber }
            : {}),
          ...(citation.pageCitationAssetUrl
            ? { pageCitationAssetUrl: citation.pageCitationAssetUrl }
            : {}),
          source: {
            documentId: citation.canonicalDocumentId,
            sourceFileName: citation.source.sourceFileName,
            sectionPath: citation.source.sectionPath,
          },
        })),
      },
    ]),
  )
}

function toParsedChunkView(
  source: SourceView,
  chunk: DemoChunk,
): ParsedChunkView {
  return parsedChunkNormalization.createParsedChunkView({
    chunkId: chunk.id,
    parserChunkId: chunk.chunkId,
    documentId: source.documentId,
    sectionPath: chunk.sectionPath,
    chunkType: chunk.chunkType,
    content: chunk.content,
    metadata: chunk.metadata,
    filePathCandidates: [chunk.filePath],
    assetUrl: chunk.assetUrl,
    sourceTitle: source.title,
  })
}

const citeMarkerPattern = /\[\[cite:\d+\]\]/

function withCitationMarkers(answer: string, citationCount: number): string {
  if (citationCount < 1 || citeMarkerPattern.test(answer)) return answer
  const markers = Array.from(
    { length: citationCount },
    (_, index) => `[[cite:${index + 1}]]`,
  ).join(" ")
  return `${answer.trimEnd()} ${markers}`
}
