/**
 * A "unit" is anything retrieval can surface and an answer can actually
 * cite. Today there are two kinds:
 *   - fluid_memory   — a `fluid_memory_items` row, keyed by its id
 *   - crystal_chunk  — a Knowhere chunk, which has no local row; keyed by
 *                      `${documentId}:${chunkId}` (see `toChunkUnitRef`)
 */
export const retrievalUnitTypes = ["fluid_memory", "crystal_chunk"] as const
export type RetrievalUnitType = (typeof retrievalUnitTypes)[number]

/** Composite key for a crystal_chunk unit ref. */
export function toChunkUnitRef(input: {
  readonly documentId: string
  readonly chunkId: string
}): string {
  return `${input.documentId}:${input.chunkId}`
}
