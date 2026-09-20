import { describe, expect, it, vi } from "vitest"

import { logger } from "@/lib/logger"

import { composeAnswerContext } from "./answer-context"
import type { EvidenceLedgerSnapshot } from "./types"

const revenuePng = new Uint8Array([1, 2, 3])
const marginPng = new Uint8Array([4, 5, 6])

describe("composeAnswerContext", () => {
  it("composes retained chunks, full table HTML, images at placeholders, memory, and the original question", async () => {
    const readTableHtml = vi.fn().mockResolvedValue(
      "<table><tr><td>Q4</td><td>24.9</td></tr></table>",
    )
    const readImage = vi.fn(async (assetUrl: string) =>
      assetUrl.includes("revenue.png")
        ? { body: revenuePng, mediaType: "image/png" }
        : { body: marginPng, mediaType: "image/png" },
    )
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
      readTableHtml,
      readImage,
    })

    expect(readTableHtml).toHaveBeenCalledWith(
      "https://assets.example/tables/revenue.html?signature=valid",
    )
    expect(readImage).toHaveBeenCalledWith(
      "https://assets.example/images/revenue.png?signature=valid",
    )
    expect(readImage).toHaveBeenCalledWith(
      "https://assets.example/images/margin.png?signature=valid",
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
          text: "\n\n\n",
        },
        {
          type: "image",
          image: marginPng,
          mediaType: "image/png",
        },
        {
          type: "text",
          text: [
            "",
            "",
            "",
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

  it("drops image placeholders and warns when the image URL cannot be read", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
    const message = await composeAnswerContext({
      ledger: makeLedger({
        content:
          "Before [images/revenue.png] after [images/margin.png] end.",
        assets: makeLedger().assets.filter((asset) => asset.type === "image"),
      }),
      memoryItems: [],
      userText: "图在哪？",
      readImage: vi.fn().mockRejectedValue(new Error("Unable to read image: 403")),
    })

    const parts = userContentParts(message)
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
    expect(text).toContain("Before  after  end.")
    expect(text).not.toContain("[images/revenue.png]")
    expect(text).not.toContain("[images/margin.png]")
    expect(parts.some((part) => part.type === "image")).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      "chat: skipped unreachable evidence asset",
      expect.objectContaining({
        type: "image",
        reason: "Unable to read image: 403",
      }),
    )
    warn.mockRestore()
  })

  it("drops table placeholders and warns when the table URL cannot be read", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
    const message = await composeAnswerContext({
      ledger: makeLedger({
        content: "Revenue [Table: tables/revenue.html] rose.",
        assets: makeLedger().assets.filter((asset) => asset.type === "table"),
      }),
      memoryItems: [],
      userText: "收入多少？",
      readTableHtml: vi.fn().mockRejectedValue(new Error("Unable to read table HTML: 404")),
    })

    const text = userContentParts(message)
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
    expect(text).toContain("Revenue  rose.")
    expect(text).not.toContain("[Table: tables/revenue.html]")
    expect(text).not.toContain("<table>")
    expect(warn).toHaveBeenCalledWith(
      "chat: skipped unreachable evidence asset",
      expect.objectContaining({
        type: "table",
        reason: "Unable to read table HTML: 404",
      }),
    )
    warn.mockRestore()
  })

  it("throws when a connected image placeholder is missing", async () => {
    await expect(
      composeAnswerContext({
        ledger: {
          ...makeLedger(),
          chunks: [
            {
              ...makeLedger().chunks[0]!,
              content: "Revenue increased in Q4.\n[Table: tables/revenue.html]",
            },
          ],
        },
        memoryItems: [],
        userText: "Q4 的收入是多少？",
        readTableHtml: vi.fn().mockResolvedValue("<table></table>"),
        readImage: vi.fn().mockResolvedValue({
          body: revenuePng,
          mediaType: "image/png",
        }),
      }),
    ).rejects.toThrow("Image placeholder")
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

function userContentParts(message: { readonly content: unknown }): readonly {
  readonly type: string
  readonly text?: string
}[] {
  if (!Array.isArray(message.content)) {
    throw new Error("expected composed message content to be an array")
  }
  return message.content
}

function makeLedger(
  overrides: {
    readonly content?: string
    readonly assets?: EvidenceLedgerSnapshot["assets"]
  } = {},
): EvidenceLedgerSnapshot {
  return {
    retrievalCount: 1,
    chunks: [
      {
        ref: "r1:result:1",
        kind: "result",
        content:
          overrides.content ??
          "Revenue increased in Q4.\n[Table: tables/revenue.html]\n[images/revenue.png]\n[images/margin.png]",
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
    assets: overrides.assets ?? [
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
