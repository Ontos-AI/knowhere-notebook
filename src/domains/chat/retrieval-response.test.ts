import { describe, expect, it } from "vitest"
import { decodeNotebookRetrievalResponse } from "./retrieval-response"

const response = {
  namespace: "__knowhere_demo__", query: "question", routerUsed: "test", answerText: null,
  results: [{ content: "Evidence", chunkType: "text", score: 1,
    source: { documentId: "demo-doc", namespace: "__knowhere_demo__", jobResultId: "result-at-retrieval" } }],
  referencedChunks: [{ chunkId: "chunk", documentId: "demo-doc", chunkType: "page", sectionPath: "page 1",
    namespace: "__knowhere_demo__", jobResultId: "reference-at-retrieval" }],
}
describe("Notebook retrieval response boundary", () => {
  it("preserves actual revisions for raw results and referenced evidence", () => {
    const decoded = decodeNotebookRetrievalResponse(response)
    expect(decoded.results[0]).toMatchObject({ source: { jobResultId: "result-at-retrieval", namespace: "__knowhere_demo__" },
      metadata: { jobResultId: "result-at-retrieval", namespace: "__knowhere_demo__" } })
    expect(decoded.referencedChunks[0]).toMatchObject({ jobResultId: "reference-at-retrieval",
      metadata: { jobResultId: "reference-at-retrieval", namespace: "__knowhere_demo__" } })
  })
  it("rejects invalid response shapes before the harness reads evidence", () => {
    expect(() => decodeNotebookRetrievalResponse({ ...response, results: [{ content: 42 }] })).toThrow()
    expect(() => decodeNotebookRetrievalResponse({ ...response, results: [{ ...response.results[0], source: { jobResultId: 42 } }] })).toThrow()
  })
  it("leaves missing revisions missing while using the actual response namespace", () => {
    const decoded = decodeNotebookRetrievalResponse({ ...response,
      results: [{ content: "Evidence", chunkType: "text", score: null, source: { documentId: "demo-doc" } }] })
    expect(decoded.results[0]?.metadata).toEqual({ namespace: "__knowhere_demo__" })
    expect(decoded.results[0]?.source).not.toHaveProperty("jobResultId")
  })
})
