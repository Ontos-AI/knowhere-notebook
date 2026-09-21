import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

export function crystalChunkUnitRef(result: {
  readonly chunkId?: string
  readonly source: { readonly documentId?: string | null }
}): string | null {
  const documentId = result.source.documentId
  const chunkId = result.chunkId
  if (!documentId || !chunkId) return null
  return `${documentId}:${chunkId}`
}

/**
 * Multiply Knowhere scores by Memento ranking factors.
 * Missing unitRef or missing factor leaves the Knowhere score unchanged.
 */
export function applyCrystalChunkRankingFactors(
  results: readonly RetrievalResult[],
  factorByUnitRef: ReadonlyMap<string, number>,
): RetrievalResult[] {
  return results.map((result) => {
    const unitRef = crystalChunkUnitRef(result)
    if (!unitRef || result.score == null) return result
    const factor = factorByUnitRef.get(unitRef)
    if (factor == null) return result
    return { ...result, score: result.score * factor }
  })
}
