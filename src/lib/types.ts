/**
 * Types that mirror the Knowhere API shape.
 * These act as a view contract: the Parsed Chunks panel reads this shape,
 * not a local DB row. When the fetch is wired up, it will come directly from
 * the Knowhere chunk API (client.retrieval / client.jobs.load) and we will not
 * persist a copy.
 */

export type ChunkType = "text" | "image" | "table";

/**
 * A parsed chunk as shown in the Parsed Content panel.
 * Subset of the Knowhere Chunk shape — only fields the UI renders.
 * See @ontos-ai/knowhere-sdk BaseChunk / TextChunk / ImageChunk / TableChunk.
 */
export type ParsedChunkView = {
  chunkId: string;
  type: ChunkType;
  content: string;
  summary?: string;
  keywords?: string[];
  pageNums?: number[];
  /** Display-only attribution — not a foreign key into a local DB. */
  sourceTitle: string;
};

export type SourceStatus = "uploading" | "parsing" | "ready" | "failed";

/**
 * A source as shown in the Sources sidebar.
 * Metadata-only view — mirrors what Postgres will store per the MVP
 * persistence rule (no chunk copies, Knowhere document IDs only).
 */
export type SourceView = {
  id: string;
  title: string;
  status: SourceStatus;
  /** Knowhere document ID once parsing publishes. */
  documentId?: string;
  /** Count from the Knowhere chunks API, not a local aggregate. */
  chunkCount?: number;
};
