import type {
  ChatCitationView,
  CitationView,
  RetrievalResultView,
} from "@/domains/chat/types"

type ChatCitationPersistence = {
  readonly normalizeCitations: (
    citations:
      | readonly (ChatCitationView | CitationView | RetrievalResultView)[]
      | null
      | undefined,
  ) => CitationView[] | null
  readonly replaceDemoCitationDocumentId: (
    citations: readonly ChatCitationView[] | undefined,
    documentId: string,
  ) => ChatCitationView[] | undefined
}

function normalizeCitations(
  citations:
    | readonly (ChatCitationView | CitationView | RetrievalResultView)[]
    | null
    | undefined,
): CitationView[] | null {
  if (!citations || citations.length === 0) return null
  return citations.map(toCitationView)
}

function replaceDemoCitationDocumentId(
  citations: readonly ChatCitationView[] | undefined,
  documentId: string,
): ChatCitationView[] | undefined {
  if (!citations) return undefined

  return citations.map((citation) => ({
    ...citation,
    source: {
      ...citation.source,
      documentId,
    },
  }))
}

function toCitationView(
  citation: ChatCitationView | CitationView | RetrievalResultView,
): CitationView {
  return {
    chunkType: citation.chunkType,
    score: citation.score,
    assetUrl: citation.assetUrl,
    description: "description" in citation ? citation.description : undefined,
    source: {
      documentId: citation.source.documentId,
      sourceFileName: citation.source.sourceFileName,
      sectionPath: citation.source.sectionPath,
    },
  }
}

export const chatCitationPersistence: ChatCitationPersistence = {
  normalizeCitations,
  replaceDemoCitationDocumentId,
}
