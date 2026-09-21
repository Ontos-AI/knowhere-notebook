import { describe, expect, it, vi } from "vitest"
import type { RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

import { createEvidenceLedger } from "./ledger"
import type { ResolveConnectedAssets } from "./types"

describe("createEvidenceLedger", () => {
  it("normalizes retrieval chunks and media assets without treating candidates as final output", () => {
    const ledger = createEvidenceLedger()

    const snapshot = ledger.addRetrievalResponse(makeRetrievalResponse())

    expect(snapshot.retrievalCount).toBe(1)
    expect(snapshot.evidence).toEqual([{ type: "text", text: "Evidence tree" }])
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
            pageAssets: [],
            page_assets: [
              {
                page_num: 4,
                artifactRef: "",
                artifact_ref: "page_citation_assets/page-4.png",
                contentType: "",
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

  it("does not throw when a result is missing chunkType", () => {
    // Knowhere's chunkType is declared as a required string in the SDK
    // type, but real retrieval results can omit it at runtime, same as the
    // referencedChunks case above. Unlike referencedChunks (which carry no
    // real content), results carry real content, so the chunk must still be
    // kept in the ledger -- only asset-type detection should be guarded.
    const ledger = createEvidenceLedger()

    const snapshot = ledger.addRetrievalResponse({
      namespace: "default",
      query: "hypertension target",
      routerUsed: "agent_explore",
      answerText: "",
      evidenceText: "[E1] some evidence",
      stopReason: "finished",
      failureReason: null,
      results: [
        {
          content: "Target BP is <130/80 mmHg.",
          chunkType: undefined as unknown as string,
          score: 0.9,
          assetUrl: "https://assets.example/images/chart.png",
          source: {
            documentId: "doc_1",
            sourceFileName: "guideline.pdf",
            sectionPath: "BP targets",
          },
        },
      ],
      referencedChunks: [],
    })

    expect(snapshot.chunks.map((chunk) => chunk.ref)).toEqual(["r1:result:1"])
    expect(snapshot.chunks[0]?.content).toBe("Target BP is <130/80 mmHg.")
    // chunkType is unknown, but the assetUrl itself has an image extension,
    // so asset detection still recognizes it as an image via the URL check.
    expect(snapshot.assets).toEqual([
      expect.objectContaining({ ref: "asset:r1:result:1", type: "image" }),
    ])
  })

  it("skips agent_explore referencedChunks that lack chunkType instead of throwing", () => {
    const ledger = createEvidenceLedger()

    const snapshot = ledger.addRetrievalResponse({
      namespace: "default",
      query: "hypertension CAD blood pressure target",
      routerUsed: "agent_explore",
      answerText: "",
      evidenceText: "[E1] some evidence",
      stopReason: "finished",
      failureReason: null,
      results: [
        {
          content: "Target BP is <130/80 mmHg.",
          chunkType: "text",
          score: 0.9,
          source: {
            documentId: "doc_1",
            sourceFileName: "guideline.pdf",
            sectionPath: "BP targets",
          },
        },
      ],
      // Real agent_explore responses carry provenance IDs without evidence
      // fields even though the SDK type declares chunkType as required.
      referencedChunks: [
        {
          documentId: "doc_1",
          chunkId: "8da0776b-c52b-5602-8579-25c421706f5f",
          pageNums: [],
        },
      ] as unknown as RetrievalQueryResponse["referencedChunks"],
    })

    expect(snapshot.chunks.map((chunk) => chunk.ref)).toEqual(["r1:result:1"])
    expect(snapshot.chunks[0]?.content).toBe("Target BP is <130/80 mmHg.")
  })

  it("keeps an empty ledger when a search adds no chunks", () => {
    const ledger = createEvidenceLedger()
    const snapshot = ledger.addRetrievalResponse({
      namespace: "notebook",
      query: "empty",
      routerUsed: "workflow_single_step",
      answerText: null,
      evidenceText: "No hits",
      stopReason: "completed",
      failureReason: null,
      results: [],
      referencedChunks: [],
    })

    expect(snapshot.chunks).toEqual([])
  })

  it("resolves every embedded table and image connected to search text", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse({
      ...makeRetrievalResponse(),
      results: [
        {
          chunkId: "text_chunk",
          content: "Comparison [tables/comparison.html]",
          chunkType: "text",
          score: 0.9,
          metadata: {
            connectTo: [
              {
                target: "table_chunk",
                relation: "embeds",
                ref: "[tables/comparison.html]",
              },
              {
                target: "image_chunk_1",
                relation: "embeds",
                ref: "[images/comparison-a.jpg]",
              },
              {
                target: "image_chunk_2",
                relation: "embeds",
                ref: "[images/comparison-b.jpg]",
              },
            ],
          },
          source: {
            documentId: "doc_1",
            sourceFileName: "cardiology.pdf",
            sectionPath: "Differential diagnosis",
          },
        },
      ],
      referencedChunks: [],
    })
    const resolveConnectedAssets = vi.fn<ResolveConnectedAssets>(
      async (lookups) =>
        lookups.map((lookup) => ({
          ...lookup,
          assetUrl: `https://assets.example/${lookup.chunkId}`,
        })),
    )

    const snapshot = await ledger.resolveConnectedAssets(
      resolveConnectedAssets,
    )

    expect(resolveConnectedAssets).toHaveBeenCalledWith([
      { documentId: "doc_1", chunkId: "table_chunk", type: "table" },
      { documentId: "doc_1", chunkId: "image_chunk_1", type: "image" },
      { documentId: "doc_1", chunkId: "image_chunk_2", type: "image" },
    ])
    expect(snapshot.assets).toEqual([
      expect.objectContaining({
        ref: "asset:r1:result:1:table_chunk",
        chunkRef: "r1:result:1",
        type: "table",
        sourcePath: "tables/comparison.html",
      }),
      expect.objectContaining({
        ref: "asset:r1:result:1:image_chunk_1",
        chunkRef: "r1:result:1",
        type: "image",
        sourcePath: "images/comparison-a.jpg",
      }),
      expect.objectContaining({
        ref: "asset:r1:result:1:image_chunk_2",
        chunkRef: "r1:result:1",
        type: "image",
        sourcePath: "images/comparison-b.jpg",
      }),
    ])
  })

  it("does not block the ledger when no connected asset resolver is provided", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse({
      ...makeRetrievalResponse(),
      results: [
        {
          chunkId: "text_chunk",
          content: "Comparison [tables/comparison.html]",
          chunkType: "text",
          score: 0.9,
          metadata: {
            connectTo: [
              {
                target: "table_chunk",
                relation: "embeds",
                ref: "[tables/comparison.html]",
              },
            ],
          },
          source: {
            documentId: "doc_1",
            sourceFileName: "cardiology.pdf",
            sectionPath: "Differential diagnosis",
          },
        },
      ],
      referencedChunks: [],
    })

    const snapshot = await ledger.resolveConnectedAssets()

    expect(snapshot.evidence).toEqual([{ type: "text", text: "Evidence tree" }])
    expect(snapshot.assets).toEqual([])
  })
})

function makeRetrievalResponse(): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "q4 revenue images",
    routerUsed: "workflow_single_step",
    answerText: null,
    evidenceText: "Evidence tree",
    evidence: [{ type: "text", text: "Evidence tree" }],
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
  } as unknown as RetrievalQueryResponse
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
