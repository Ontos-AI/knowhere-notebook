import { describe, expect, it } from "vitest"
import type { RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

import { createEvidenceLedger } from "./ledger"

describe("createEvidenceLedger", () => {
  it("normalizes retrieval chunks and media assets without treating candidates as final output", () => {
    const ledger = createEvidenceLedger()

    const snapshot = ledger.addRetrievalResponse(makeRetrievalResponse())

    expect(snapshot.retrievalCount).toBe(1)
    expect(snapshot.chunks.map((chunk) => chunk.ref)).toEqual([
      "r1:result:1",
      "r1:result:2",
      "r1:referenced:1",
    ])
    expect(snapshot.assets).toEqual([
      expect.objectContaining({
        ref: "asset:r1:result:2",
        chunkRef: "r1:result:2",
        type: "image",
      }),
      expect.objectContaining({
        ref: "asset:r1:referenced:1",
        chunkRef: "r1:referenced:1",
        type: "image",
      }),
    ])
  })

  it("reads only evidence already returned by retrieval", () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makeRetrievalResponse())

    expect(ledger.read("r1:result:1", 0, 7)).toMatchObject({
      found: true,
      contentSlice: "Revenue",
      hasMoreContent: true,
    })
    expect(ledger.read("missing")).toMatchObject({
      found: false,
      contentSlice: "",
    })
  })
})

function makeRetrievalResponse(): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "q4 revenue images",
    routerUsed: "workflow_single_step",
    answerText: null,
    evidenceText: "Evidence tree",
    stopReason: "answer_done",
    failureReason: null,
    decisionTrace: [{ step: "search" }],
    results: [
      {
        content: "Revenue increased in Q4.",
        chunkType: "text",
        score: 0.9,
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Q4",
        },
      },
      {
        content: "",
        chunkType: "image",
        score: 0.8,
        assetUrl: "https://assets.example/images/chart.png",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "images/chart.png",
        },
      },
    ],
    referencedChunks: [
      {
        chunkId: "chunk_image",
        documentId: "doc_1",
        chunkType: "image",
        sectionPath: "images/photo.jpg",
        assetUrl: "https://assets.example/images/photo.jpg",
      },
    ],
  }
}
