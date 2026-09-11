import { describe, expect, it, vi } from "vitest"

import { composeAnswerContext } from "./answer-context"
import type { EvidenceLedgerSnapshot } from "./types"

describe("composeAnswerContext", () => {
  it("composes retained chunks, full table HTML, images, memory, and the original question", async () => {
    const readTableHtml = vi.fn().mockResolvedValue(
      "<table><tr><td>Q4</td><td>24.9</td></tr></table>",
    )
    const message = await composeAnswerContext({
      ledger: makeLedger(),
      memoryItems: [
        {
          ref: "mem:1",
          itemId: "memory_1",
          kind: "stance",
          abstractL0: "关注毛利率",
          overviewL1: "用户把毛利率当作核心指标。",
        },
      ],
      userText: "Q4 的收入是多少？",
      readTableHtml,
    })

    expect(readTableHtml).toHaveBeenCalledWith(
      "https://assets.example/tables/revenue.html?signature=valid",
    )
    expect(message).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "## Evidence from Knowledge Base",
            "",
            "[pick 1] report.pdf › Summary",
            '[artifact type="table" ref="asset:r1:result:1:table_chunk"]',
            "Revenue increased in Q4.",
            "<table><tr><td>Q4</td><td>24.9</td></tr></table>",
            "",
            '[image ref="asset:r1:result:1:image_chunk_1"]',
          ].join("\n"),
        },
        {
          type: "image",
          image: new URL("https://assets.example/images/revenue.png?signature=valid"),
        },
        {
          type: "text",
          text: '[image ref="asset:r1:result:1:image_chunk_2"]',
        },
        {
          type: "image",
          image: new URL("https://assets.example/images/margin.png?signature=valid"),
        },
        {
          type: "text",
          text: [
            "## Fluid Memory",
            "",
            '[memory ref="mem:1" itemId="memory_1" kind="stance"]',
            "关注毛利率",
            "用户把毛利率当作核心指标。",
            "",
            "## User's Question",
            "Q4 的收入是多少？",
          ].join("\n"),
        },
      ],
    })
  })

  it("omits knowledge and memory sections when neither search ran", async () => {
    const message = await composeAnswerContext({
      ledger: { ...makeLedger(), retrievalCount: 0, retainedPicks: [] },
      memoryItems: [],
      userText: "直接回答。",
    })

    expect(message).toEqual({
      role: "user",
      content: [{ type: "text", text: "## User's Question\n直接回答。" }],
    })
  })

  it("notes when knowledge base search ran but found nothing to retain", async () => {
    const message = await composeAnswerContext({
      ledger: { ...makeLedger(), retainedPicks: [] },
      memoryItems: [],
      userText: "直接回答。",
    })

    expect(message).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "## Evidence from Knowledge Base",
            "No knowledge base results were found for this search. Answer using your own knowledge only, and say so if relevant.",
            "",
            "## User's Question",
            "直接回答。",
          ].join("\n"),
        },
      ],
    })
  })

  it("notes when memory search ran but found nothing", async () => {
    const message = await composeAnswerContext({
      ledger: { ...makeLedger(), retrievalCount: 0, retainedPicks: [] },
      memoryItems: [],
      memorySearchAttempted: true,
      userText: "直接回答。",
    })

    expect(message).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "## Fluid Memory",
            "No fluid memory results were found for this search.",
            "",
            "## User's Question",
            "直接回答。",
          ].join("\n"),
        },
      ],
    })
  })
})

function makeLedger(): EvidenceLedgerSnapshot {
  return {
    retrievalCount: 1,
    chunks: [
      {
        ref: "r1:result:1",
        kind: "result",
        content: "Revenue increased in Q4.\n[Table: tables/revenue.html]",
        contentPreview: "Revenue increased in Q4. [Table: tables/revenue.html]",
        chunkType: "text",
        score: 0.9,
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Summary",
        },
      },
    ],
    assets: [
      {
        ref: "asset:r1:result:1:table_chunk",
        chunkRef: "r1:result:1",
        type: "table",
        assetUrl: "https://assets.example/tables/revenue.html?signature=valid",
        sourcePath: "tables/revenue.html",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Summary",
        },
        label: "report.pdf / Summary / tables/revenue.html / table",
      },
      {
        ref: "asset:r1:result:1:image_chunk_1",
        chunkRef: "r1:result:1",
        type: "image",
        assetUrl: "https://assets.example/images/revenue.png?signature=valid",
        sourcePath: "images/revenue.png",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Summary",
        },
        label: "report.pdf / Summary / images/revenue.png / image",
      },
      {
        ref: "asset:r1:result:1:image_chunk_2",
        chunkRef: "r1:result:1",
        type: "image",
        assetUrl: "https://assets.example/images/margin.png?signature=valid",
        sourcePath: "images/margin.png",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Summary",
        },
        label: "report.pdf / Summary / images/margin.png / image",
      },
    ],
    evidenceText: [],
    stopReasons: [],
    failureReasons: [],
    decisionTraces: [],
    retainedPicks: [1],
    pendingRetention: null,
  }
}
