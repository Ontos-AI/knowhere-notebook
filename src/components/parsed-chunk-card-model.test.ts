// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import type { ParsedChunkView } from "@/domains/chunks/types"
import { parsedChunkCardModel } from "./parsed-chunk-card-model"

describe("parsedChunkCardModel", () => {
  it("derives source metadata without rendering a Parsed Chunk Card", () => {
    const metadata = parsedChunkCardModel.getSourceMetadata(
      makeChunk({
        type: "text",
        pageNums: [4, 2, 4, 8, 9],
        sectionPath:
          "Default_Root/TSLA-Q4-2025-Update.pdf-->FINANCIAL SUMMARY",
      }),
    )

    expect(metadata).toEqual({
      pageLabel: "Pages 2, 4, 8-9",
      sectionLabel: "FINANCIAL SUMMARY",
      typeLabel: "Text",
    })
  })

  it("labels page chunks and formats continuous page ranges", () => {
    const metadata = parsedChunkCardModel.getSourceMetadata(
      makeChunk({
        type: "page",
        pageNums: [6, 4, 5],
        sectionPath: "Default_Root/manual.pdf-->pages/4-6",
      }),
    )

    expect(metadata).toEqual({
      pageLabel: "Pages 4-6",
      sectionLabel: "pages/4-6",
      typeLabel: "Page",
    })
  })

  it("splits text content into text and reference parts with display-ready labels", () => {
    const parts = parsedChunkCardModel.getTextContentParts(
      makeChunk({
        content:
          "See [images/image-1.jpg] and [tables/missing.html] for details.",
        connections: [
          {
            targetParserChunkId: "parser_image_1",
            targetChunkId: "image_1",
            relation: "embeds",
            ref: "[images/image-1.jpg]",
            position: { start: 4, end: 24 },
          },
          {
            targetParserChunkId: "missing_parser",
            relation: "embeds",
            ref: "[tables/missing.html]",
            position: { start: 29, end: 50 },
          },
        ],
      }),
    )

    expect(parts).toEqual([
      { type: "text", text: "See " },
      {
        type: "reference",
        key: "[images/image-1.jpg]-0",
        label: "Image 1",
        targetChunkId: "image_1",
        isResolved: true,
        connection: expect.objectContaining({
          targetChunkId: "image_1",
          ref: "[images/image-1.jpg]",
        }),
      },
      { type: "text", text: " and " },
      {
        type: "reference",
        key: "[tables/missing.html]-1",
        label: "Missing",
        targetChunkId: null,
        isResolved: false,
        connection: expect.objectContaining({
          targetParserChunkId: "missing_parser",
          ref: "[tables/missing.html]",
        }),
      },
      { type: "text", text: " for details." },
    ])
  })

  it("sanitizes only table HTML content", () => {
    const safeHtml = parsedChunkCardModel.getSanitizedTableHtml(
      '<table><tbody><tr><td onclick="alert(1)">Value</td></tr></tbody></table><script>alert(1)</script>',
    )

    expect(safeHtml).toContain("Value")
    expect(safeHtml).not.toContain("onclick")
    expect(safeHtml).not.toContain("script")
    expect(parsedChunkCardModel.getSanitizedTableHtml("Plain table text")).toBeNull()
  })
})

function makeChunk(overrides: Partial<ParsedChunkView> = {}): ParsedChunkView {
  return {
    chunkId: "chunk_1",
    type: "text",
    content: "Parsed content.",
    sourceTitle: "manual.pdf",
    ...overrides,
  }
}
