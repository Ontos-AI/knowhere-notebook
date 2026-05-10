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

export type ParsedChunkConnection = {
  targetParserChunkId: string;
  targetChunkId?: string;
  relation: "embeds" | "related" | string;
  ref?: string;
  position?: {
    start: number;
    end: number;
  };
};

/**
 * Parsed Content panel row — mirrors the SDK document-chunk shape.
 */
export type ParsedChunkView = {
  chunkId: string;
  /** Parser-provided chunk_id. Connection metadata targets this id. */
  parserChunkId?: string;
  /** Knowhere document ID. Present when loaded through a Notebook source. */
  documentId?: string;
  /** Human-readable section path from Knowhere, used to focus citations. */
  sectionPath?: string | null;
  type: ChunkType;
  content: string;
  /** ZIP-relative parsed artifact path, e.g. images/image-1.jpg. */
  filePath?: string;
  /** Public Blob URL for parsed media/table artifacts when Notebook stored it. */
  assetUrl?: string;
  summary?: string;
  keywords?: string[];
  pageNums?: number[];
  connections?: ParsedChunkConnection[];
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

/**
 * Persisted chat citation metadata. This deliberately excludes
 * `RetrievalResultView.content` so Notebook never stores source chunk text in
 * Postgres; full chunks stay upstream in Knowhere and are fetched on demand.
 */
export type CitationView = Omit<RetrievalResultView, "content">;

/**
 * UI chat citation. Fresh answers include retrieval `content` so the browser
 * can focus the exact parsed section. Persisted history only has metadata, so
 * `content` is optional here.
 */
export type ChatCitationView = CitationView & {
  content?: string;
};

export type ChatMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitationView[];
};

export type ChatThreadView = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type SourceStatus = "uploading" | "parsing" | "ready" | "failed";

export type SourceOriginalFileView = {
  url: string;
  mimeType: string;
  sizeBytes?: number;
  canDownload?: boolean;
};

/**
 * Sources sidebar row — metadata-only, per the MVP persistence rule.
 */
export type SourceView = {
  id: string;
  title: string;
  /** Browser-provided content type for preview routing. */
  mimeType: string;
  status: SourceStatus;
  /** Knowhere document ID once parsing publishes. */
  documentId?: string;
  /** Public Blob URL for original-file preview and download. */
  originalFile?: SourceOriginalFileView;
  /** Count from the Knowhere chunks API, not a local aggregate. */
  chunkCount?: number;
  /** User opt-out for this query session. Drives excludeDocumentIds. */
  excludedFromQuery?: boolean;
};
