/**
 * UI-facing view types that mirror the Knowhere SDK contract.
 *
 * Two distinct shapes because the Knowhere API exposes two different read
 * paths with different fields:
 *
 *   - Document chunks API (BaseChunk / TextChunk / ImageChunk / TableChunk)
 *     → used by the Parsed Content panel. Has chunkId, keywords, summary,
 *       pageNums. Fetched on-demand, never persisted locally.
 *
 *   - Retrieval query API (RetrievalResult)
 *     → used by chat answers / citations. No chunkId; has score, assetUrl,
 *       and a richer source ref (documentId, sourceFileName, sectionPath).
 *
 * Keep these in sync with @ontos-ai/knowhere-sdk. Do not add fields the SDK
 * does not return, and do not assume chunkId on retrieval results.
 */

export type ChunkType = "text" | "image" | "table";

/**
 * Parsed Content panel row — mirrors the SDK document-chunk shape.
 */
export type ParsedChunkView = {
  chunkId: string;
  type: ChunkType;
  content: string;
  summary?: string;
  keywords?: string[];
  pageNums?: number[];
  /** Display-only attribution. */
  sourceTitle: string;
};

/**
 * Chat citation / retrieval hit — mirrors RetrievalResult from the SDK.
 * No chunkId here; retrieval does not expose one.
 */
export type RetrievalResultView = {
  content: string;
  chunkType: string;
  score: number;
  assetUrl?: string;
  source: {
    documentId?: string;
    sourceFileName?: string;
    sectionPath?: string;
  };
};

export type SourceStatus = "uploading" | "parsing" | "ready" | "failed";

/**
 * Sources sidebar row — metadata-only, per the MVP persistence rule.
 */
export type SourceView = {
  id: string;
  title: string;
  status: SourceStatus;
  /** Knowhere document ID once parsing publishes. */
  documentId?: string;
  /** Count from the Knowhere chunks API, not a local aggregate. */
  chunkCount?: number;
  /** User opt-out for this query session. Drives excludeDocumentIds. */
  excludedFromQuery?: boolean;
};
