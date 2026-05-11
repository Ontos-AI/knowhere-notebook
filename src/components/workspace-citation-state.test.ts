import { describe, expect, it } from "vitest"

import { workspaceCitationState } from "./workspace-citation-state"
import type { ChatCitationView } from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"

describe("workspaceCitationState", () => {
  it("finds the Source and loaded Parsed Chunk for a Citation", () => {
    const source: SourceView = {
      id: "source_1",
      title: "Contract.pdf",
      status: "ready",
      mimeType: "application/pdf",
      documentId: "document_1",
    }
    const citation: ChatCitationView = {
      chunkType: "text",
      score: 0.93,
      content: "Revenue grew in the quarter.",
      source: {
        documentId: "document_1",
        sourceFileName: "Contract.pdf",
        sectionPath: "Revenue",
      },
    }
    const chunks: ParsedChunkView[] = [
      {
        chunkId: "chunk_1",
        documentId: "document_1",
        sectionPath: "Revenue",
        type: "text",
        content: "Revenue grew in the quarter.",
        sourceTitle: "Contract.pdf",
      },
    ]

    expect(
      workspaceCitationState.findCitationSource([source], citation),
    ).toEqual(source)
    expect(
      workspaceCitationState.getLoadedCitationChunkId({
        citation,
        selectedSourceId: source.id,
        sourceId: source.id,
        selectedChunks: chunks,
        hasMoreSelectedChunks: false,
      }),
    ).toBe("chunk_1")
  })

  it("does not focus stale chunks from another selected Source", () => {
    const citation: ChatCitationView = {
      chunkType: "text",
      score: 0.93,
      content: "Revenue grew in the quarter.",
      source: {
        documentId: "document_1",
      },
    }

    expect(
      workspaceCitationState.getLoadedCitationChunkId({
        citation,
        selectedSourceId: "source_2",
        sourceId: "source_1",
        selectedChunks: [
          {
            chunkId: "chunk_1",
            documentId: "document_1",
            type: "text",
            content: "Revenue grew in the quarter.",
            sourceTitle: "Contract.pdf",
          },
        ],
        hasMoreSelectedChunks: true,
      }),
    ).toBeNull()
  })
})
