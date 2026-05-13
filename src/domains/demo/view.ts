import { parsedChunkNormalization } from "@/domains/chunks/normalization"
import type { ChatMessageView } from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
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
  return {
    id: source.demoSourceId,
    kind: "demo",
    demoSourceId: source.demoSourceId,
    title: source.title,
    mimeType: source.mimeType,
    status: "ready",
    documentId: source.canonicalDocumentId,
    originalFile: {
      url: `/api/demo-sources/${encodeURIComponent(source.demoSourceId)}/original`,
      mimeType: source.originalFile.mimeType,
      sizeBytes: source.originalFile.sizeBytes,
      canDownload: source.originalFile.canDownload,
    },
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
        content: example.answer,
        citations: example.citations.map((citation) => ({
          chunkType: citation.chunkType,
          score: 0.95,
          content: citation.content,
          ...(citation.description
            ? { description: citation.description }
            : {}),
          source: {
            documentId: citation.source.documentId,
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
