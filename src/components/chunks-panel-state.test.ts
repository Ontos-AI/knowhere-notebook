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
    // A focused chunk shows alone: the list is filtered to the destination
    // chunk instead of reordering the whole document around it.
    expect(
      chunksPanelState
        .getChunksWithFocusedFirst(chunks, "chunk_page_7")
        .map((chunk) => chunk.chunkId),
    ).toEqual(["chunk_page_7"])
  })

  it("shows only the focused chunk and never mutates the input", () => {
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
    ).toEqual([chunks[1]])
    expect(chunks.map((chunk) => chunk.chunkId)).toEqual([
      "chunk_1",
      "chunk_2",
    ])
  })

  it("returns an empty list when the focused chunk is not present", () => {
    const chunks: ParsedChunkView[] = [
      {
        chunkId: "chunk_1",
        type: "text",
        content: "First",
        sourceTitle: "notes.pdf",
      },
    ]

    expect(
      chunksPanelState.getChunksWithFocusedFirst(chunks, "missing_chunk"),
    ).toEqual([])
  })

  it("deduplicates repeated chunk ids before ordering and building the section tree", () => {
    type TestSectionTreeNode = {
      readonly chunkCount: number
      readonly chunks: readonly ParsedChunkView[]
      readonly children: readonly TestSectionTreeNode[]
    }
    const buildSectionTree = (
      chunksPanelState as typeof chunksPanelState & {
        readonly buildSectionTree?: (
          chunks: readonly ParsedChunkView[],
          sourceTitle: string,
        ) => TestSectionTreeNode
      }
    ).buildSectionTree
    const chunks: ParsedChunkView[] = [
      {
        chunkId: "duplicate_chunk",
        type: "text",
        content: "First copy.",
        sectionPath: "manual.pdf/Overview",
        sourceTitle: "manual.pdf",
        pageNums: [1],
      },
      {
        chunkId: "other_chunk",
        type: "text",
        content: "Other chunk.",
        sectionPath: "manual.pdf/Overview",
        sourceTitle: "manual.pdf",
        pageNums: [2],
      },
      {
        chunkId: "duplicate_chunk",
        type: "text",
        content: "Duplicate copy.",
        sectionPath: "manual.pdf/Overview",
        sourceTitle: "manual.pdf",
        pageNums: [3],
      },
    ]

    expect(
      chunksPanelState
        .getChunksWithFocusedFirst(chunks, null)
        .map((chunk) => chunk.content),
    ).toEqual(["First copy.", "Other chunk."])

    const tree = buildSectionTree?.(chunks, "manual.pdf")
    const overviewSection = tree?.children[0]

    expect(tree?.chunkCount).toBe(2)
    expect(overviewSection?.chunks.map((chunk) => chunk.content)).toEqual([
      "First copy.",
      "Other chunk.",
    ])
  })

  it("formats Knowhere section paths and reference labels for display", () => {
    expect(
      chunksPanelState.formatChunkSectionPath(
        "Default_Root/Document-->Revenue-->Table 1",
      ),
    ).toBe("Revenue / Table 1")
    expect(
      chunksPanelState.formatChunkSectionPath(
        "Default_Root/Document--!>Revenue--!>Table 1",
      ),
    ).toBe("Revenue / Table 1")
    expect(
      chunksPanelState.formatReferenceLabel("[images/image-12.png?token=abc]"),
    ).toBe("Image 12")
  })

  it("builds a section tree from slash and arrow separated Knowhere paths", () => {
    type TestSectionTreeNode = {
      readonly label: string
      readonly chunks: readonly ParsedChunkView[]
      readonly children: readonly TestSectionTreeNode[]
    }
    const buildSectionTree = (
      chunksPanelState as typeof chunksPanelState & {
        readonly buildSectionTree?: (
          chunks: readonly ParsedChunkView[],
          sourceTitle: string,
        ) => TestSectionTreeNode
      }
    ).buildSectionTree
    const tableChunk: ParsedChunkView = {
      chunkId: "table_chunk",
      parserChunkId: "parser_table",
      type: "table",
      content: "<table />",
      sectionPath: "tables/table-1.html",
      filePath: "tables/table-1.html",
      sourceTitle: "manual.pdf",
    }
    const chunks: ParsedChunkView[] = [
      {
        chunkId: "overview_chunk",
        parserChunkId: "parser_overview",
        type: "text",
        content: "Overview text",
        sectionPath: "manual.pdf/Overview",
        sourceTitle: "manual.pdf",
      },
      {
        chunkId: "robotics_chunk",
        parserChunkId: "parser_robotics",
        type: "text",
        content: "Robotics [tables/table-1.html]",
        sectionPath: "manual.pdf-->Outlook/Product-->Robotics",
        sourceTitle: "manual.pdf",
        connections: [
          {
            targetParserChunkId: "parser_table",
            targetChunkId: "table_chunk",
            relation: "embeds",
            ref: "[tables/table-1.html]",
          },
        ],
      },
      tableChunk,
    ]

    const tree = buildSectionTree?.(chunks, "manual.pdf")

    expect(tree?.children.map((child) => child.label)).toEqual([
      "Overview",
      "Outlook",
    ])
    expect(tree?.children[0]?.chunks.map((chunk) => chunk.chunkId)).toEqual([
      "overview_chunk",
    ])
    expect(tree?.children[1]?.children[0]?.label).toBe("Product")
    expect(
      tree?.children[1]?.children[0]?.children[0]?.chunks.map(
        (chunk) => chunk.chunkId,
      ),
    ).toEqual(["robotics_chunk", "table_chunk"])
  })
})
