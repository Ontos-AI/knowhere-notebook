import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentChunk } from "@ontos-ai/knowhere-sdk";

import type { Source } from "./schema";
import { loadChunksForSource, toParsedChunkView } from "./chunks";

describe("toParsedChunkView", () => {
  it("maps Knowhere document chunks to the parsed-content view shape", () => {
    const chunk: DocumentChunk = {
      id: "document_chunk_1",
      chunkId: "parser_chunk_1",
      chunkType: "text",
      content: "Notebook should show parsed text from Knowhere only on demand.",
      sectionId: "section_1",
      sectionPath: "Introduction",
      sourceChunkPath: null,
      filePath: null,
      sortOrder: 1,
      metadata: {
        summary: "Intro summary",
        keywords: ["notebook", "parsed"],
        pageNums: [1, 2],
      },
      assetUrl: null,
    };

    expect(toParsedChunkView(chunk, "notes.txt")).toEqual({
      chunkId: "document_chunk_1",
      type: "text",
      content: "Notebook should show parsed text from Knowhere only on demand.",
      summary: "Intro summary",
      keywords: ["notebook", "parsed"],
      pageNums: [1, 2],
      sourceTitle: "notes.txt",
    });
  });
});

describe("loadChunksForSource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches parsed chunks only through the Knowhere document chunks API", async () => {
    const listChunks = vi.fn().mockResolvedValue({
      chunks: [
        makeDocumentChunk({
          id: "document_chunk_1",
          chunkId: "parser_chunk_1",
          content: "Source text from Knowhere",
        }),
      ],
      pagination: { total: 1 },
    });
    const source = makeSource({
      title: "notes.txt",
      knowhereDocumentId: "doc_123",
    });

    const chunks = await loadChunksForSource(source, {
      documents: { listChunks },
    });

    expect(listChunks).toHaveBeenCalledWith("doc_123", {
      page: 1,
      pageSize: 100,
      includeAssetUrls: true,
    });
    expect(chunks).toEqual([
      {
        chunkId: "document_chunk_1",
        type: "text",
        content: "Source text from Knowhere",
        sourceTitle: "notes.txt",
      },
    ]);
  });

  it("returns no chunks for sources that are not ready", async () => {
    const listChunks = vi.fn();
    const source = makeSource({
      status: "parsing",
      knowhereDocumentId: null,
    });

    await expect(
      loadChunksForSource(source, { documents: { listChunks } }),
    ).resolves.toEqual([]);
    expect(listChunks).not.toHaveBeenCalled();
  });
});

function makeDocumentChunk(
  overrides: Partial<DocumentChunk> = {},
): DocumentChunk {
  return {
    id: "document_chunk_1",
    chunkId: "parser_chunk_1",
    chunkType: "text",
    content: "Chunk content",
    sectionId: null,
    sectionPath: null,
    sourceChunkPath: null,
    filePath: null,
    sortOrder: 1,
    metadata: {},
    assetUrl: null,
    ...overrides,
  };
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 100,
    status: "ready",
    failureReason: null,
    knowhereJobId: "job_123",
    knowhereDocumentId: "doc_123",
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}
