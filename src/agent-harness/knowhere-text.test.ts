import { describe, expect, it } from "vitest"
import type {
  KnowledgeGrepResponse,
  KnowledgeOutline,
  KnowledgeReadResponse,
  RetrievalQueryResponse,
} from "@ontos-ai/knowhere-sdk"

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
      chunks: snapshot.chunks,
      assets: snapshot.assets,
    })

    expect(text).toContain('<knowhere operation="search" status="ok">')
    expect(text).toContain('ref="r1:result:1"')
    expect(text).toContain('ref="asset:r1:result:1"')
    expect(text).toContain("Call inspectImage")
    expect(text).not.toContain("https://assets.example/page-1.png")
  })

  it("formats list and outline responses", () => {
    const listText = knowhereToolText.formatListDocuments({
      documents: [
        {
          documentId: "doc_1",
          revisionKey: "job_1",
          namespace: "notebook",
          sourceFileName: "report.pdf",
          title: "Report",
          status: "ready",
        },
      ],
    })
    const outlineText = knowhereToolText.formatOutline(makeOutlineResponse())

    expect(listText).toContain('<knowhere operation="list_documents" status="ok">')
    expect(listText).toContain('documentId="doc_1"')
    expect(outlineText).toContain(
      '<knowhere operation="get_document_outline" status="ok">',
    )
    expect(outlineText).toContain('sectionPath="Root / Revenue"')
  })

  it("formats full read chunk bodies without truncating large content", () => {
    const ledger = createEvidenceLedger()
    const largeContent = `BEGIN ${"full chunk body ".repeat(700)} END`
    const response = makeReadResponse(largeContent)
    const snapshot = ledger.addReadChunksResponse(response)

    const text = knowhereToolText.formatReadChunks({
      response,
      chunks: snapshot.chunks,
      assets: snapshot.assets,
    })

    expect(text).toContain('<knowhere operation="read_chunks" status="ok">')
    expect(text).toContain('ref="read1:chunk:1"')
    expect(text).toContain(largeContent)
    expect(text).not.toContain("...[truncated]")
    expect(text).not.toContain("https://assets.example/page-1.png")
  })

  it("formats grep matches with continuation metadata", () => {
    const ledger = createEvidenceLedger()
    const response = makeGrepResponse()
    const snapshot = ledger.addGrepChunksResponse(response)

    const text = knowhereToolText.formatGrepChunks({
      response,
      chunks: snapshot.chunks,
      assets: snapshot.assets,
    })

    expect(text).toContain('<knowhere operation="grep_chunks" status="ok">')
    expect(text).toContain('truncated="true"')
    expect(text).toContain('continuationCursor="cursor_2"')
    expect(text).toContain('ref="grep1:match:1"')
    expect(text).toContain("matched penalty snippet")
  })

  it("formats errors as tagged text", () => {
    expect(
      knowhereToolText.formatError({
        operation: "read_chunks",
        message: "A documentId is required.",
      }),
    ).toBe(
      [
        '<knowhere operation="read_chunks" status="error">',
        "<message>",
        "A documentId is required.",
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

function makeReadResponse(content: string): KnowledgeReadResponse {
  return {
    document: {
      localDocumentId: "doc_1",
      documentId: "doc_1",
      jobId: "job_1",
      namespace: "notebook",
      sourceFileName: "report.pdf",
      chunkCount: 1,
      typeCounts: { text: 0, image: 0, table: 0, page: 1 },
      resultDirectoryPath: "parsed-storage:doc_1/job_1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    chunks: [
      {
        position: 1,
        chunkId: "chunk_page_1",
        chunkType: "page",
        contentSource: "content",
        content,
        readableContent: content,
        sectionPath: "Root / Page 1",
        sourceChunkPath: "pages/page-1.md",
        filePath: "pages/page-1.png",
        assetUrl: "https://assets.example/page-1.png",
        pageNumbers: [1],
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
      },
    ],
    page: 1,
    pageSize: 1,
    totalChunks: 1,
    totalPages: 1,
  }
}

function makeOutlineResponse(): KnowledgeOutline {
  return {
    document: {
      localDocumentId: "doc_1",
      documentId: "doc_1",
      jobId: "job_1",
      namespace: "notebook",
      sourceFileName: "report.pdf",
      chunkCount: 1,
      typeCounts: { text: 1, image: 0, table: 0, page: 0 },
      resultDirectoryPath: "parsed-storage:doc_1/job_1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    totalChunks: 1,
    typeCounts: { text: 1, image: 0, table: 0, page: 0 },
    sections: [
      {
        sectionPath: "Root / Revenue",
        sectionTitle: "Revenue",
        sectionLevel: 2,
        summary: "Revenue summary.",
        startChunk: 1,
        endChunk: 1,
        chunkCount: 1,
        typeCounts: { text: 1, image: 0, table: 0, page: 0 },
        children: [],
      },
    ],
    sectionTree: [],
  }
}

function makeGrepResponse(): KnowledgeGrepResponse {
  return {
    document: {
      localDocumentId: "doc_1",
      documentId: "doc_1",
      jobId: "job_1",
      namespace: "notebook",
      sourceFileName: "contract.pdf",
      chunkCount: 4,
      typeCounts: { text: 4, image: 0, table: 0, page: 0 },
      resultDirectoryPath: "parsed-storage:doc_1/job_1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    matches: [
      {
        position: 3,
        chunkId: "chunk_3",
        chunkType: "text",
        sectionPath: "Root / Penalties",
        sourceChunkPath: "chunks/chunk-3.md",
        filePath: "contract.pdf",
        startOffset: 10,
        endOffset: 17,
        snippet: "matched penalty snippet",
      },
    ],
    scannedChunks: 4,
    truncated: true,
    continuationCursor: "cursor_2",
  }
}
