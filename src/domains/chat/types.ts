/**
 * Chat citation / retrieval hit. Mirrors RetrievalResult from the SDK.
 */
export type RetrievalResultView = {
  readonly content: string
  readonly chunkType: string
  readonly score: number | null
  readonly assetUrl?: string
  readonly pageCitationAssetUrl?: string
  readonly pageCitationPageNumber?: number
  readonly source: {
    readonly documentId?: string | null
    readonly sourceFileName?: string | null
    readonly sectionPath?: string | null
  }
}

/**
 * Persisted chat citation metadata. This deliberately excludes source chunk
 * text so Notebook never stores upstream chunk content in Postgres.
 */
export type CitationView = Omit<RetrievalResultView, "content"> & {
  readonly description?: string
}

/**
 * UI chat citation. Fresh answers include retrieval content; persisted
 * history only has metadata, so content is optional here.
 */
export type ChatCitationView = CitationView & {
  readonly content?: string
}

/**
 * Normalized highlight box for page/image answer provenance.
 * Origin top-left; values in [0, 1]. No per-region labels.
 */
export type ChatImageHighlightBox = {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export type ChatArtifactView = {
  readonly type: "image" | "table" | "derived_table"
  readonly ref?: string
  readonly title?: string
  readonly columns?: readonly string[]
  readonly rows?: readonly (readonly string[])[]
  readonly sourceRefs?: readonly string[]
  readonly assetUrl?: string
  readonly label?: string
  readonly display?: boolean
  readonly reason?: string
  readonly highlightRegions?: readonly ChatImageHighlightBox[]
  readonly citation?: ChatCitationView
}

export type ChatMessageView = {
  readonly id: string
  readonly role: "user" | "assistant"
  readonly content: string
  readonly citations?: readonly ChatCitationView[]
  readonly artifacts?: readonly ChatArtifactView[]
}

export type ChatThreadView = {
  readonly id: string
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
}
