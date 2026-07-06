import { describe, expect, it, vi } from "vitest"
import type { Knowledge } from "@ontos-ai/knowhere-sdk"

import { readAllSourceChunks, readSourceChunkPage } from "./read"

function makeReadChunk(overrides: Record<string, unknown> = {}) {
  return {
    position: 1,
    chunkId: "parser_1",
    chunkType: "text",
    content: "Body",
    readableContent: "Body",
    sectionPath: "Summary",
    sourceChunkPath: "Summary",
    filePath: undefined,
    assetUrl: undefined,
    metadata: {},
    ...overrides,
  }
}

describe("readSourceChunkPage", () => {
  it("reads a page with durable asset URLs and maps chunks to the view model", async () => {
    const readChunks = vi.fn(async () => ({
      document: { localDocumentId: "doc_1" },
      chunks: [
        makeReadChunk({
          chunkType: "image",
          filePath: "images/a.png",
          assetUrl: "https://blob.example/images/a.png",
        }),
      ],
      page: 2,
      pageSize: 50,
      totalChunks: 120,
      totalPages: 3,
    }))
    const knowledge = { readChunks } as unknown as Knowledge

    const result = await readSourceChunkPage({
      knowledge,
      source: { documentId: "doc_1", title: "notes.pdf", revisionKey: "rev_1" },
      params: { page: 2, pageSize: 50 },
    })

    expect(readChunks).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "rev_1",
      page: 2,
      pageSize: 50,
      assetUrlPolicy: "durable",
    })
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 50,
      total: 120,
      totalPages: 3,
    })
    expect(result.chunks[0]).toMatchObject({
      parserChunkId: "parser_1",
      documentId: "doc_1",
      assetUrl: "https://blob.example/images/a.png",
      sourceTitle: "notes.pdf",
    })
  })

  it("omits revisionKey when the source has none", async () => {
    const readChunks = vi.fn(async () => ({
      document: { localDocumentId: "doc_1" },
      chunks: [],
      page: 1,
      pageSize: 50,
      totalChunks: 0,
      totalPages: 1,
    }))
    const knowledge = { readChunks } as unknown as Knowledge

    await readSourceChunkPage({
      knowledge,
      source: { documentId: "doc_1", title: "notes.pdf", revisionKey: null },
      params: { page: 1, pageSize: 50 },
    })

    expect(readChunks).toHaveBeenCalledWith({
      documentId: "doc_1",
      page: 1,
      pageSize: 50,
      assetUrlPolicy: "durable",
    })
  })
})

describe("readAllSourceChunks", () => {
  it("pages the SDK to exhaustion", async () => {
    const readChunks = vi
      .fn()
      .mockResolvedValueOnce({
        document: { localDocumentId: "doc_1" },
        chunks: [makeReadChunk({ chunkId: "c1" })],
        page: 1,
        pageSize: 200,
        totalChunks: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        document: { localDocumentId: "doc_1" },
        chunks: [makeReadChunk({ chunkId: "c2" })],
        page: 2,
        pageSize: 200,
        totalChunks: 2,
        totalPages: 2,
      })
    const knowledge = { readChunks } as unknown as Knowledge

    const chunks = await readAllSourceChunks({
      knowledge,
      source: { documentId: "doc_1", title: "notes.pdf", revisionKey: "rev_1" },
    })

    expect(readChunks).toHaveBeenCalledTimes(2)
    expect(readChunks).toHaveBeenNthCalledWith(1, {
      documentId: "doc_1",
      revisionKey: "rev_1",
      page: 1,
      pageSize: 200,
      assetUrlPolicy: "durable",
    })
    expect(chunks.map((chunk) => chunk.parserChunkId)).toEqual(["c1", "c2"])
  })
})
