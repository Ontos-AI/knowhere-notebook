import { describe, expect, it } from "vitest"

import { chunksPanelState } from "./chunks-panel-state"
import type { ParsedChunkView } from "@/domains/chunks/types"

describe("chunksPanelState", () => {
  it("orders chunks by their first page number before applying focus", () => {
    const chunks: ParsedChunkView[] = [
      {
        chunkId: "chunk_without_page",
        type: "text",
        content: "Appendix",
        sourceTitle: "notes.pdf",
      },
      {
        chunkId: "chunk_page_7",
        type: "text",
        content: "Later page",
        sourceTitle: "notes.pdf",
        pageNums: [7],
      },
      {
        chunkId: "chunk_page_2",
        type: "text",
        content: "Earlier page",
        sourceTitle: "notes.pdf",
        pageNums: [2, 3],
      },
      {
        chunkId: "chunk_page_7_second",
        type: "text",
        content: "Same page",
        sourceTitle: "notes.pdf",
        pageNums: [7],
      },
    ]

    expect(
      chunksPanelState
        .getChunksWithFocusedFirst(chunks, null)
        .map((chunk) => chunk.chunkId),
    ).toEqual([
      "chunk_page_2",
      "chunk_page_7",
      "chunk_page_7_second",
      "chunk_without_page",
    ])
    expect(
      chunksPanelState
        .getChunksWithFocusedFirst(chunks, "chunk_page_7")
        .map((chunk) => chunk.chunkId),
    ).toEqual([
      "chunk_page_7",
      "chunk_page_2",
      "chunk_page_7_second",
      "chunk_without_page",
    ])
  })

  it("moves a focused Parsed Chunk to the front without mutating the input", () => {
    const chunks: ParsedChunkView[] = [
      {
        chunkId: "chunk_1",
        type: "text",
        content: "First",
        sourceTitle: "notes.pdf",
      },
      {
        chunkId: "chunk_2",
        type: "text",
        content: "Second",
        sourceTitle: "notes.pdf",
      },
    ]

    expect(
      chunksPanelState.getChunksWithFocusedFirst(chunks, "chunk_2"),
    ).toEqual([chunks[1], chunks[0]])
    expect(chunks.map((chunk) => chunk.chunkId)).toEqual([
      "chunk_1",
      "chunk_2",
    ])
  })

  it("formats Knowhere section paths and reference labels for display", () => {
    expect(
      chunksPanelState.formatChunkSectionPath(
        "Default_Root/Document-->Revenue-->Table 1",
      ),
    ).toBe("Revenue / Table 1")
    expect(
      chunksPanelState.formatReferenceLabel("[images/image-12.png?token=abc]"),
    ).toBe("Image 12")
  })

})
