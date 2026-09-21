import { describe, expect, it } from "vitest"

import { composeAnswerContext } from "./answer-context"
import type { EvidenceLedgerSnapshot } from "./types"

const revenuePng = new Uint8Array([1, 2, 3])

describe("composeAnswerContext", () => {
  it("uses Knowhere evidence, memory, and the original question", async () => {
    const message = await composeAnswerContext({
      ledger: makeLedger(),
      memoryItems: [
        {
          ref: "mem:1",
          itemId: "memory_1",
          kind: "stance",
          text: "关注毛利率 用户把毛利率当作核心指标。",
        },
      ],
      userText: "Q4 的收入是多少？",
    })

    expect(message).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "## Evidence from Knowledge Base",
            "Revenue increased in Q4.",
            "<table><tr><td>Q4</td><td>24.9</td></tr></table>",
            "",
          ].join("\n"),
        },
        {
          type: "image",
          image: revenuePng,
          mediaType: "image/png",
        },
        {
          type: "text",
          text: [
            "## Fluid Memory",
            "",
            '[memory ref="mem:1" kind="stance"]',
            "关注毛利率 用户把毛利率当作核心指标。",
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
      ledger: {
        ...makeLedger(),
        retrievalCount: 0,
        chunks: [],
        evidence: [],
      },
      memoryItems: [],
      userText: "hello",
    })

    expect(message).toEqual({
      role: "user",
      content: [{ type: "text", text: "## User's Question\nhello" }],
    })
  })

  it("says no knowledge base results when search ran but evidence is empty", async () => {
    const message = await composeAnswerContext({
      ledger: {
        ...makeLedger(),
        evidence: [],
      },
      memoryItems: [],
      userText: "Q4?",
    })

    const text = userContentParts(message)
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
    expect(text).toContain("No knowledge base results were found")
    expect(text).not.toContain("<table>")
  })
})

function makeLedger(): EvidenceLedgerSnapshot {
  return {
    retrievalCount: 1,
    chunks: [
      {
        ref: "r1:result:1",
        kind: "result",
        content: "Revenue increased in Q4.\n[tables/revenue.html]\n[images/revenue.png]",
        contentPreview: "Revenue increased in Q4.",
        chunkType: "text",
        score: 0.9,
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "Summary",
        },
      },
    ],
    assets: [],
    evidence: [
      {
        type: "text",
        text: "Revenue increased in Q4.\n<table><tr><td>Q4</td><td>24.9</td></tr></table>\n",
      },
      {
        type: "image",
        mediaType: "image/png",
        data: Buffer.from(revenuePng).toString("base64"),
      },
    ],
    evidenceText: [],
    stopReasons: [],
    failureReasons: [],
    decisionTraces: [],
  }
}

function userContentParts(message: { readonly content: unknown }): readonly {
  readonly type: string
  readonly text?: string
}[] {
  if (!Array.isArray(message.content)) {
    throw new Error("expected composed message content to be an array")
  }
  return message.content
}
