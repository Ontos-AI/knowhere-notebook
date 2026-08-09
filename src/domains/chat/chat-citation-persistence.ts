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

function toCitationView(
  citation: ChatCitationView | CitationView | RetrievalResultView,
): CitationView {
  return {
    chunkType: citation.chunkType,
    score: citation.score,
    chunkId: citation.chunkId,
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
  normalizeArtifacts,
}
