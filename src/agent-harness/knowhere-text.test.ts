import { describe, expect, it } from "vitest"
import type { RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

import { createEvidenceLedger } from "./ledger"
import { knowhereToolText } from "./knowhere-text"

describe("knowhereToolText", () => {
  it("formats search results as tagged text with refs and no raw asset URLs", () => {
    const ledger = createEvidenceLedger()
    const response = makeSearchResponse()
    const snapshot = ledger.addRetrievalResponse(response)

    const text = knowhereToolText.formatSearch({
      response,
      retrievalCount: snapshot.retrievalCount,
      chunkPickStart: 0,
      chunks: snapshot.chunks,
      assets: snapshot.assets,
    })

    expect(text).toContain('<knowhere operation="search" status="ok">')
    expect(text).toContain('pick="1"')
    expect(text).toContain('ref="r1:result:1"')
    expect(text).toContain('ref="asset:r1:result:1"')
    expect(text).toContain("Page one summary.")
    expect(text).toContain("Call inspectImage")
    expect(text).toContain("before finalize")
    expect(text).not.toContain("<evidence>")
    expect(text).not.toContain("Page one evidence.")
    expect(text).not.toContain("https://assets.example/page-1.png")
  })

  it("formats errors as tagged text", () => {
    expect(
      knowhereToolText.formatError({
        operation: "search",
        message: "Knowhere search failed.",
      }),
    ).toBe(
      [
        '<knowhere operation="search" status="error">',
        "<message>",
        "Knowhere search failed.",
        "</message>",
        "</knowhere>",
      ].join("\n"),
    )
  })
})

function makeSearchResponse(): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "page one",
    routerUsed: "workflow_single_step",
    answerText: null,
    evidenceText: "Page one evidence.",
    stopReason: "answer_done",
    failureReason: null,
    results: [
      {
        content: "Page one summary.",
        chunkType: "page",
        score: 0.91,
        assetUrl: "https://assets.example/page-1.png",
        metadata: {
          pageNums: [1],
          pageAssets: [
            {
              pageNum: 1,
              artifactRef: "page_citation_assets/page-1.png",
              assetUrl: "https://assets.example/page-1.png",
              contentType: "image/png",
            },
          ],
        },
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Root / Page 1",
        },
      },
    ],
    referencedChunks: [],
  }
}
