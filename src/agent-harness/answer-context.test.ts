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
            "Revenue increased in Q4.",
            "",
            "[pick 2] report.pdf › Revenue table",
            "<table><tr><td>Q4</td><td>24.9</td></tr></table>",
            "",
            "[pick 3] report.pdf › Chart",
          ].join("\n"),
        },
        {
          type: "image",
          image: new URL("https://assets.example/images/revenue.png?signature=valid"),
        },
        {
          type: "text",
          text: [
            "## Fluid Memory",
            "",
            "[mem:1] stance",
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

  it("omits empty knowledge and memory sections", async () => {
    const message = await composeAnswerContext({
      ledger: { ...makeLedger(), retainedPicks: [] },
      memoryItems: [],
      userText: "直接回答。",
    })

    expect(message).toEqual({
      role: "user",
      content: [{ type: "text", text: "## User's Question\n直接回答。" }],
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
        content: "Revenue increased in Q4.",
        contentPreview: "Revenue increased in Q4.",
        chunkType: "text",
        score: 0.9,
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Summary",
        },
      },
      {
        ref: "r1:result:2",
        kind: "result",
        content: "[Table: tables/revenue.html]",
        contentPreview: "[Table: tables/revenue.html]",
        chunkType: "table",
        score: 0.8,
        assetRef: "asset:r1:result:2",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Revenue table",
        },
      },
      {
        ref: "r1:result:3",
        kind: "result",
        content: "",
        contentPreview: "",
        chunkType: "image",
        score: 0.7,
        assetRef: "asset:r1:result:3",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Chart",
        },
      },
    ],
    assets: [
      {
        ref: "asset:r1:result:2",
        chunkRef: "r1:result:2",
        type: "table",
        assetUrl: "https://assets.example/tables/revenue.html?signature=valid",
        sourcePath: "tables/revenue.html",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Revenue table",
        },
        label: "report.pdf / Revenue table / tables/revenue.html / table",
      },
      {
        ref: "asset:r1:result:3",
        chunkRef: "r1:result:3",
        type: "image",
        assetUrl: "https://assets.example/images/revenue.png?signature=valid",
        sourcePath: "images/revenue.png",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Chart",
        },
        label: "report.pdf / Chart / images/revenue.png / image",
      },
    ],
    evidenceText: [],
    stopReasons: [],
    failureReasons: [],
    decisionTraces: [],
    retainedPicks: [1, 2, 3],
    pendingRetention: null,
  }
}
