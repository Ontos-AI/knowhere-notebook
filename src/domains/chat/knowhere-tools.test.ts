import { describe, expect, it, vi } from "vitest"
import type { RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

import { notebookKnowhereTools } from "./knowhere-tools"

describe("notebookKnowhereTools", () => {
  it("does not authorize document scope from an ID-only reference", async () => {
    const searchSources = vi.fn().mockResolvedValue(
      makeResponse([
        {
          documentId: "doc_provenance",
          chunkId: "chunk_provenance",
          pageNums: [],
        },
      ]),
    )
    const runtime = notebookKnowhereTools.createRuntime({
      searchSources,
      sources: [],
    })

    await runtime.search({ query: "first" })

    await expect(
      runtime.search({
        query: "second",
        includeDocumentIds: ["doc_provenance"],
      }),
    ).rejects.toThrow("unverified ID")
  })

  it("authorizes document scope from a structured referenced asset", async () => {
    const searchSources = vi.fn().mockResolvedValue(
      makeResponse([
        {
          documentId: "doc_asset",
          chunkId: "chunk_asset",
          chunkType: "image",
          filePath: "images/asset.png",
        },
      ]),
    )
    const runtime = notebookKnowhereTools.createRuntime({
      searchSources,
      sources: [],
    })

    await runtime.search({ query: "first" })
    await runtime.search({ query: "second", includeDocumentIds: ["doc_asset"] })

    expect(searchSources).toHaveBeenCalledTimes(2)
  })
})

function makeResponse(
  referencedChunks: readonly Record<string, unknown>[],
): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "query",
    routerUsed: "agent_explore",
    answerText: null,
    evidenceText: null,
    results: [],
    referencedChunks:
      referencedChunks as unknown as RetrievalQueryResponse["referencedChunks"],
  }
}
