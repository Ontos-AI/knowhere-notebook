import { describe, expect, it } from "vitest"
import type {
  KnowledgeGrepResponse,
  KnowledgeReadResponse,
  RetrievalQueryResponse,
} from "@ontos-ai/knowhere-sdk"

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

  it("creates page image assets from live page citation asset URLs without metadata", () => {
    const ledger = createEvidenceLedger()

    const snapshot = ledger.addRetrievalResponse(
      makePageAssetUrlRetrievalResponse(),
    )

    expect(snapshot.assets).toContainEqual(
      expect.objectContaining({
        ref: "asset:r1:referenced:1",
        chunkRef: "r1:referenced:1",
        type: "image",
        assetUrl:
          "https://knowhere-storage.example/results/job_1/page_citation_assets/page-8.png?AWSAccessKeyId=test",
        sourcePath: "page_citation_assets/page-8.png",
        revisionKey: "job_1",
      }),
    )
  })

  it("creates page image assets from snake-case retrieval metadata", () => {
    const ledger = createEvidenceLedger()

    const snapshot = ledger.addRetrievalResponse({
      namespace: "notebook",
      query: "revenue",
      routerUsed: "mapnav",
      answerText: null,
      evidenceText: "Revenue evidence",
      stopReason: "completed",
      failureReason: null,
      results: [
        {
          chunkId: "chunk_page_4",
          content: "Revenue was $24.9B.",
          chunkType: "page",
          score: 0.9,
          metadata: {
            page_nums: [4],
            page_assets: [
              {
                page_num: 4,
                artifact_ref: "page_citation_assets/page-4.png",
                content_type: "image/png",
              },
            ],
          },
          source: {
            documentId: "doc_tsla",
            sourceFileName: "TSLA-Q4-2025-Update.pdf",
            sectionPath: "FINANCIAL SUMMARY",
          },
        },
      ],
      referencedChunks: [],
    })

    expect(snapshot.assets).toContainEqual(
      expect.objectContaining({
        ref: "asset:r1:result:1",
        sourcePath: "page_citation_assets/page-4.png",
        type: "image",
      }),
    )
  })

  it("adds read chunk refs and page image assets", () => {
    const ledger = createEvidenceLedger()

    const snapshot = ledger.addReadChunksResponse(makeReadResponse())

    expect(snapshot.chunks).toEqual([
      expect.objectContaining({
        ref: "read1:chunk:1",
        kind: "read_chunk",
        content: "Full page content.",
        contentPreview: "Full page content.",
        assetRef: "asset:read1:chunk:1",
      }),
    ])
    expect(snapshot.assets).toEqual([
      expect.objectContaining({
        ref: "asset:read1:chunk:1",
        chunkRef: "read1:chunk:1",
        type: "image",
        sourcePath: "page_citation_assets/page-1.png",
      }),
    ])
  })

  it("adds grep match refs", () => {
    const ledger = createEvidenceLedger()

    const snapshot = ledger.addGrepChunksResponse(makeGrepResponse())

    expect(snapshot.chunks).toEqual([
      expect.objectContaining({
        ref: "grep1:match:1",
        kind: "grep_match",
        chunkId: "chunk_3",
        content: "matched penalty snippet",
        source: expect.objectContaining({
          documentId: "doc_contract",
          sourceFileName: "contract.pdf",
          sectionPath: "Root / Penalties",
        }),
      }),
    ])
  })

  it("copies page metadata onto grep matches from the same chunk id", () => {
    const ledger = createEvidenceLedger()
    ledger.addReadChunksResponse(makeReadResponse())

    const snapshot = ledger.addGrepChunksResponse({
      ...makeGrepResponse(),
      matches: [
        {
          position: 1,
          chunkId: "chunk_page_1",
          chunkType: "page",
          sectionPath: "Root / Page 1",
          sourceChunkPath: "pages/page-1.md",
          startOffset: 0,
          endOffset: 12,
          snippet: "Full page snip",
        },
      ],
    })

    expect(snapshot.chunks[1]).toEqual(
      expect.objectContaining({
        ref: "grep1:match:1",
        kind: "grep_match",
        chunkId: "chunk_page_1",
        metadata: expect.objectContaining({
          pageNums: [1],
          position: 1,
          startOffset: 0,
          endOffset: 12,
        }),
      }),
    )
  })

  it("copies pageNumbers from the grep match when the SDK provides them", () => {
    const ledger = createEvidenceLedger()

    const snapshot = ledger.addGrepChunksResponse({
      ...makeGrepResponse(),
      matches: [
        {
          position: 1,
          chunkId: "chunk_page_4",
          chunkType: "page",
          sectionPath: "FINANCIAL SUMMARY",
          sourceChunkPath: "pages/page-4.md",
          startOffset: 0,
          endOffset: 12,
          snippet: "automotive revenues",
          pageNumbers: [4],
        },
      ],
    })

    expect(snapshot.chunks[0]).toEqual(
      expect.objectContaining({
        ref: "grep1:match:1",
        kind: "grep_match",
        chunkId: "chunk_page_4",
        metadata: expect.objectContaining({
          pageNums: [4],
          position: 1,
          startOffset: 0,
          endOffset: 12,
        }),
      }),
    )
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

function makePageAssetUrlRetrievalResponse(): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "承包人 进度计划 修改 违约金",
    routerUsed: "workflow_single_step",
    answerText: null,
    evidenceText:
      "Root / （6）现场工期进度管理方面的违约责任 [Page PDF (page 8)]",
    stopReason: "answer_done",
    failureReason: null,
    results: [],
    referencedChunks: [
      {
        chunkId: "node_3a513cf7-77d7-5c62-a9bd-6a1109123e2c",
        documentId: "doc_contract",
        chunkType: "page",
        sectionPath: "Root / （6）现场工期进度管理方面的违约责任",
        filePath: null,
        jobId: "job_1",
        assetUrl:
          "https://knowhere-storage.example/results/job_1/page_citation_assets/page-8.png?AWSAccessKeyId=test",
      },
    ],
  }
}

function makeReadResponse(): KnowledgeReadResponse {
  return {
    document: {
      localDocumentId: "doc_contract",
      documentId: "doc_contract",
      jobId: "job_contract",
      namespace: "notebook",
      sourceFileName: "contract.pdf",
      chunkCount: 1,
      typeCounts: { text: 0, image: 0, table: 0, page: 1 },
      resultDirectoryPath: "parsed-storage:doc_contract/job_contract",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    chunks: [
      {
        position: 1,
        chunkId: "chunk_page_1",
        chunkType: "page",
        content: "Full page content.",
        readableContent: "Full page content.",
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
  }
}

function makeGrepResponse(): KnowledgeGrepResponse {
  return {
    document: {
      localDocumentId: "doc_contract",
      documentId: "doc_contract",
      jobId: "job_contract",
      namespace: "notebook",
      sourceFileName: "contract.pdf",
      chunkCount: 4,
      typeCounts: { text: 4, image: 0, table: 0, page: 0 },
      resultDirectoryPath: "parsed-storage:doc_contract/job_contract",
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
    truncated: false,
  }
}
