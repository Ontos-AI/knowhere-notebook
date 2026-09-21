import { describe, expect, it } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import {
  applyCrystalChunkRankingFactors,
  crystalChunkUnitRef,
} from "./retrieval-ranking"

describe("crystalChunkUnitRef", () => {
  it("matches the reported crystal unit ref", () => {
    expect(
      crystalChunkUnitRef({
        chunkId: "chunk_1",
        source: { documentId: "doc_1" },
      }),
    ).toBe("doc_1:chunk_1")
  })

  it("returns null when the Knowhere row has no chunk id", () => {
    expect(
      crystalChunkUnitRef({
        source: { documentId: "doc_1" },
      }),
    ).toBeNull()
  })
})

describe("applyCrystalChunkRankingFactors", () => {
  it("leaves Knowhere scores unchanged when there is no ledger row", () => {
    const results = [
      makeResult({ chunkId: "chunk_new", score: 0.8 }),
      makeResult({ chunkId: "chunk_old", score: 0.4 }),
    ]
    expect(
      applyCrystalChunkRankingFactors(results, new Map()),
    ).toEqual(results)
  })

  it("multiplies only rows that have a ranking factor", () => {
    const results = [
      makeResult({ chunkId: "chunk_used", score: 0.8 }),
      makeResult({ chunkId: "chunk_new", score: 0.6 }),
    ]
    const mixed = applyCrystalChunkRankingFactors(
      results,
      new Map([["doc_1:chunk_used", 1.25]]),
    )
    expect(mixed[0]?.score).toBeCloseTo(1, 5)
    expect(mixed[1]?.score).toBe(0.6)
  })

  it("leaves a null Knowhere score alone", () => {
    const results = [makeResult({ chunkId: "chunk_used", score: null })]
    expect(
      applyCrystalChunkRankingFactors(
        results,
        new Map([["doc_1:chunk_used", 1.5]]),
      ),
    ).toEqual(results)
  })
})

function makeResult(
  overrides: Partial<RetrievalResult> & { readonly chunkId?: string },
): RetrievalResult {
  return {
    content: "text",
    chunkType: "text",
    score: 0.5,
    source: { documentId: "doc_1" },
    ...overrides,
  }
}
