import type {
  ChatArtifactView,
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
  readonly normalizeArtifacts: (
    artifacts: readonly ChatArtifactView[] | null | undefined,
  ) => ChatArtifactView[] | null
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

function normalizeArtifacts(
  artifacts: readonly ChatArtifactView[] | null | undefined,
): ChatArtifactView[] | null {
  if (!artifacts) return null
  if (artifacts.length === 0) return []
  return artifacts.map(toArtifactView)
}

function toArtifactView(artifact: ChatArtifactView): ChatArtifactView {
  return {
    type: artifact.type,
    ref: artifact.ref,
    title: artifact.title,
    columns: artifact.columns,
    rows: artifact.rows,
    sourceRefs: artifact.sourceRefs,
    assetUrl: artifact.assetUrl,
    label: artifact.label,
    display: artifact.display,
    reason: artifact.reason,
    citation: artifact.citation
      ? toCitationView(artifact.citation)
      : undefined,
  }
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
    pageCitationAssetUrl: citation.pageCitationAssetUrl,
    pageCitationPageNumber: citation.pageCitationPageNumber,
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
  normalizeArtifacts,
  replaceDemoCitationDocumentId,
}
