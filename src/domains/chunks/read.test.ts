import { describe, expect, it, vi } from "vitest"
import type { DocumentChunk, Knowledge } from "@ontos-ai/knowhere-sdk"

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
  it("uses parsed-storage chunks without durable asset hardening", async () => {
    const listChunks = vi.fn()
    const readChunks = vi.fn(async () => ({
      document: {
        localDocumentId: "doc_1",
        resultDirectoryPath: "parsed-storage:doc_1",
      },
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
      client: { documents: { listChunks } },
      knowledge,
      source: { documentId: "doc_1", title: "notes.pdf", revisionKey: "rev_1" },
      params: { page: 2, pageSize: 50 },
    })

    expect(readChunks).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "rev_1",
      page: 2,
      pageSize: 50,
    })
    expect(listChunks).not.toHaveBeenCalled()
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

  it("falls back to Knowhere asset URLs when the parsed-storage probe reads remote chunks", async () => {
    const readChunks = vi.fn(async () => ({
      document: {
        localDocumentId: "doc_1",
        resultDirectoryPath: "remote:doc_1",
      },
      chunks: [makeReadChunk({ chunkType: "image", filePath: "images/a.png" })],
      page: 1,
      pageSize: 50,
      totalChunks: 1,
      totalPages: 1,
    }))
    const listChunks = vi.fn(async () => ({
      chunks: [
        makeRemoteDocumentChunk({
          id: "document_chunk_1",
          chunkId: "parser_1",
          chunkType: "image",
          content: "Body",
          sectionId: null,
          sectionPath: "Summary",
          sourceChunkPath: "Summary",
          filePath: "images/a.png",
          sortOrder: 0,
          metadata: {},
          assetUrl: "https://knowhere.example/assets/a.png",
        }),
      ],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    }))
    const knowledge = { readChunks } as unknown as Knowledge

    const result = await readSourceChunkPage({
      client: { documents: { listChunks } },
      knowledge,
      source: { documentId: "doc_1", title: "notes.pdf", revisionKey: "rev_1" },
      params: { page: 1, pageSize: 50 },
    })

    expect(readChunks).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "rev_1",
      page: 1,
      pageSize: 50,
    })
    expect(listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 50,
      includeAssetUrls: true,
    })
    expect(result.chunks[0]?.assetUrl).toBe(
      "https://knowhere.example/assets/a.png",
    )
  })

  it("uses SDK remote chunks directly when the SDK returns usable asset URLs", async () => {
    const listChunks = vi.fn()
    const readChunks = vi.fn(async () => ({
      document: {
        localDocumentId: "doc_1",
        resultDirectoryPath: "remote:doc_1",
      },
      chunks: [
        makeReadChunk({
          chunkType: "image",
          filePath: "images/a.png",
          assetUrl: "https://sdk.example/assets/a.png",
        }),
      ],
      page: 1,
      pageSize: 50,
      totalChunks: 1,
      totalPages: 1,
    }))
    const knowledge = { readChunks } as unknown as Knowledge

    const result = await readSourceChunkPage({
      client: { documents: { listChunks } },
      knowledge,
      source: { documentId: "doc_1", title: "notes.pdf", revisionKey: "rev_1" },
      params: { page: 1, pageSize: 50 },
    })

    expect(listChunks).not.toHaveBeenCalled()
    expect(result.chunks[0]?.assetUrl).toBe("https://sdk.example/assets/a.png")
  })

  it("omits revisionKey when the source has none", async () => {
    const listChunks = vi.fn()
    const readChunks = vi.fn(async () => ({
      document: {
        localDocumentId: "doc_1",
        resultDirectoryPath: "parsed-storage:doc_1",
      },
      chunks: [],
      page: 1,
      pageSize: 50,
      totalChunks: 0,
      totalPages: 1,
    }))
    const knowledge = { readChunks } as unknown as Knowledge

    await readSourceChunkPage({
      client: { documents: { listChunks } },
      knowledge,
      source: { documentId: "doc_1", title: "notes.pdf", revisionKey: null },
      params: { page: 1, pageSize: 50 },
    })

    expect(readChunks).toHaveBeenCalledWith({
      documentId: "doc_1",
      page: 1,
      pageSize: 50,
    })
  })
})

function makeRemoteDocumentChunk(
  overrides: Partial<DocumentChunk> = {},
): DocumentChunk {
  return {
    id: "document_chunk_1",
    chunkId: "parser_1",
    chunkType: "text",
    content: "Body",
    sectionId: null,
    sectionPath: "Summary",
    sourceChunkPath: "Summary",
    filePath: null,
    sortOrder: 0,
    metadata: {},
    assetUrl: null,
    ...overrides,
  }
}

describe("readAllSourceChunks", () => {
  it("pages the SDK to exhaustion", async () => {
    const listChunks = vi.fn()
    const readChunks = vi
      .fn()
      .mockResolvedValueOnce({
        document: {
          localDocumentId: "doc_1",
          resultDirectoryPath: "parsed-storage:doc_1",
        },
        chunks: [makeReadChunk({ chunkId: "c1" })],
        page: 1,
        pageSize: 200,
        totalChunks: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        document: {
          localDocumentId: "doc_1",
          resultDirectoryPath: "parsed-storage:doc_1",
        },
        chunks: [makeReadChunk({ chunkId: "c2" })],
        page: 2,
        pageSize: 200,
        totalChunks: 2,
        totalPages: 2,
      })
    const knowledge = { readChunks } as unknown as Knowledge

    const chunks = await readAllSourceChunks({
      client: { documents: { listChunks } },
      knowledge,
      source: { documentId: "doc_1", title: "notes.pdf", revisionKey: "rev_1" },
    })

    expect(readChunks).toHaveBeenCalledTimes(2)
    expect(readChunks).toHaveBeenNthCalledWith(1, {
      documentId: "doc_1",
      revisionKey: "rev_1",
      page: 1,
      pageSize: 200,
    })
    expect(listChunks).not.toHaveBeenCalled()
    expect(chunks.map((chunk) => chunk.parserChunkId)).toEqual(["c1", "c2"])
  })
})
