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
    documentIdMap: ReadonlyMap<string, string>,
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
  documentIdMap: ReadonlyMap<string, string>,
): ChatCitationView[] | undefined {
  if (!citations) return undefined

  return citations.map((citation) => {
    const newId = citation.source.documentId
      ? documentIdMap.get(citation.source.documentId)
      : undefined
    if (!newId) return citation

    return {
      ...citation,
      source: {
        ...citation.source,
        documentId: newId,
      },
    }
  })
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
