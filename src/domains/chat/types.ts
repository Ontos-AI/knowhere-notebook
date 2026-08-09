/**
 * Chat citation / retrieval hit. Mirrors RetrievalResult from the SDK.
 * chunkId is the parser-provided chunk identifier returned by retrieval
 * when available; it lets citations resolve to page chunks by id even
 * when content is a snippet window.
 */
export type RetrievalResultView = {
  readonly content: string
  readonly chunkType: string
  readonly score: number | null
  readonly chunkId?: string
  readonly assetUrl?: string
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
  readonly citation?: ChatCitationView
}

export type ChatMessageView = {
  readonly id: string
  readonly role: "user" | "assistant"
  readonly content: string
  readonly citations?: readonly ChatCitationView[]
  readonly artifacts?: readonly ChatArtifactView[]
  readonly retrievalTrace?: RetrievalTraceView
}

/**
 * Transient retrieval trace attached to a fresh assistant message. It is
 * returned by the chat route and held in client state only; it is never
 * persisted to the chat message row.
 */
export type RetrievalTraceEntryView = {
  readonly query: string
  readonly namespace: string
  readonly resultCount: number
  readonly referencedChunkCount: number
  readonly topScores: readonly number[]
}

export type RetrievalTraceView = {
  /** Wall-clock time to answer the question, in seconds (1 decimal). */
  readonly durationSeconds?: number
  /** Total LLM step calls made by the agent harness for this answer. */
  readonly llmCallCount?: number
  /** Total input tokens consumed by the harness for this answer. */
  readonly inputTokens?: number
  /** Total output tokens produced by the harness for this answer. */
  readonly outputTokens?: number
  readonly queries: readonly RetrievalTraceEntryView[]
}

export type ChatThreadView = {
  readonly id: string
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
}
