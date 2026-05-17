import { describe, expect, it } from "vitest"

import {
  maxPrefetchedChunkSources,
  workspaceCitationState,
} from "./workspace-citation-state"
import type { ChatCitationView } from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"

function makeChunk(chunkId: string, documentId: string): ParsedChunkView {
  return {
    chunkId,
    documentId,
    type: "text",
    content: `${chunkId} content`,
    sourceTitle: `${documentId}.pdf`,
  }
}

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

  describe("hasExactCitationTargetHint", () => {
    it("returns true when the citation has content text", () => {
      const citation: ChatCitationView = {
        chunkType: "text",
        score: 0.5,
        content: "Revenue grew this quarter.",
        source: { documentId: "document_1", sourceFileName: "Contract.pdf" },
      }

      expect(
        workspaceCitationState.hasExactCitationTargetHint(citation),
      ).toBe(true)
    })

    it("returns true when the citation has a meaningful section path", () => {
      const citation: ChatCitationView = {
        chunkType: "text",
        score: 0.5,
        source: {
          documentId: "document_1",
          sectionPath: "Revenue",
        },
      }

      expect(
        workspaceCitationState.hasExactCitationTargetHint(citation),
      ).toBe(true)
    })

    it("returns false for source-only citations with no useful target hint", () => {
      const citation: ChatCitationView = {
        chunkType: "text",
        score: 0.5,
        source: {
          documentId: "document_1",
          sourceFileName: "Contract.pdf",
          sectionPath: "Root",
        },
      }

      expect(
        workspaceCitationState.hasExactCitationTargetHint(citation),
      ).toBe(false)
    })

    it("returns false for empty content and missing section path", () => {
      const citation: ChatCitationView = {
        chunkType: "text",
        score: 0.5,
        content: "   ",
        source: { documentId: "document_1" },
      }

      expect(
        workspaceCitationState.hasExactCitationTargetHint(citation),
      ).toBe(false)
    })
  })

  describe("upsertPrefetchedChunks bounded LRU", () => {
    it("keeps insertion order so the newest source appears last", () => {
      const next = workspaceCitationState.upsertPrefetchedChunks(
        workspaceCitationState.upsertPrefetchedChunks({}, "source_a", [
          makeChunk("a", "doc_a"),
        ]),
        "source_b",
        [makeChunk("b", "doc_b")],
      )

      expect(Object.keys(next)).toEqual(["source_a", "source_b"])
    })

    it("refreshes recency for an existing source by moving it to the end", () => {
      const seed = workspaceCitationState.upsertPrefetchedChunks(
        workspaceCitationState.upsertPrefetchedChunks({}, "source_a", [
          makeChunk("a", "doc_a"),
        ]),
        "source_b",
        [makeChunk("b", "doc_b")],
      )

      const refreshed = workspaceCitationState.upsertPrefetchedChunks(
        seed,
        "source_a",
        [makeChunk("a", "doc_a"), makeChunk("a2", "doc_a")],
      )

      expect(Object.keys(refreshed)).toEqual(["source_b", "source_a"])
      expect(refreshed["source_a"]?.length).toBe(2)
    })

    it(`evicts the oldest entries when more than ${maxPrefetchedChunkSources} sources are stored`, () => {
      const seeded = Array.from({ length: maxPrefetchedChunkSources }).reduce<
        Readonly<Record<string, ParsedChunkView[]>>
      >(
        (acc, _value, index) =>
          workspaceCitationState.upsertPrefetchedChunks(
            acc,
            `source_${index}`,
            [makeChunk(`chunk_${index}`, `doc_${index}`)],
          ),
        {},
      )

      const next = workspaceCitationState.upsertPrefetchedChunks(
        seeded,
        "source_overflow",
        [makeChunk("chunk_overflow", "doc_overflow")],
      )

      const keys = Object.keys(next)
      expect(keys.length).toBe(maxPrefetchedChunkSources)
      expect(keys).not.toContain("source_0")
      expect(keys).toContain("source_overflow")
      expect(keys[keys.length - 1]).toBe("source_overflow")
    })
  })

  describe("removePrefetchedChunks", () => {
    it("returns the same record when the source is not cached", () => {
      const seed = workspaceCitationState.upsertPrefetchedChunks({}, "source_a", [
        makeChunk("a", "doc_a"),
      ])

      const next = workspaceCitationState.removePrefetchedChunks(
        seed,
        "missing",
      )

      expect(next).toBe(seed)
    })

    it("removes only the requested source", () => {
      const seed = workspaceCitationState.upsertPrefetchedChunks(
        workspaceCitationState.upsertPrefetchedChunks({}, "source_a", [
          makeChunk("a", "doc_a"),
        ]),
        "source_b",
        [makeChunk("b", "doc_b")],
      )

      const next = workspaceCitationState.removePrefetchedChunks(
        seed,
        "source_a",
      )

      expect(Object.keys(next)).toEqual(["source_b"])
    })
  })
})
