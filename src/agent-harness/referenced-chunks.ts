import type { RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

type ReferencedChunk = RetrievalQueryResponse["referencedChunks"][number]

export function hasReferencedChunkEvidence(chunk: ReferencedChunk): boolean {
  return typeof chunk.chunkType === "string" && chunk.chunkType.trim().length > 0
}
