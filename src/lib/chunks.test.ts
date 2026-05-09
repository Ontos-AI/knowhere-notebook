import { afterEach, describe, expect, it, vi } from "vitest"
import type { DocumentChunk } from "@ontos-ai/knowhere-sdk"
import { Effect } from "effect"

import type { Source } from "./schema"
import {
  loadChunksForSource,
  resolveCitationChunk,
  toParsedChunkView,
} from "./chunks"
import type { ChatCitationView } from "./types"

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
      documentId: undefined,
      sectionPath: "Introduction",
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

    const chunks = await Effect.runPromise(
      loadChunksForSource(source, {
        documents: { listChunks },
      }),
    )

    expect(listChunks).toHaveBeenCalledWith("doc_123", {
      page: 1,
      pageSize: 100,
      includeAssetUrls: true,
    });
    expect(chunks).toEqual([
      {
        chunkId: "document_chunk_1",
        documentId: "doc_123",
        sectionPath: null,
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
      Effect.runPromise(
        loadChunksForSource(source, { documents: { listChunks } }),
      ),
    ).resolves.toEqual([]);
    expect(listChunks).not.toHaveBeenCalled();
  });
});

describe("resolveCitationChunk", () => {
  it("matches a citation to the unique chunk with the same section path", () => {
    const chunk = resolveCitationChunk(
      makeRetrievalResultView({
        content: "Different short excerpt",
        source: {
          documentId: "doc_123",
          sourceFileName: "notes.txt",
          sectionPath: "2. Method",
        },
      }),
      [
        makeParsedChunkView({ chunkId: "chunk_intro", sectionPath: "1. Intro" }),
        makeParsedChunkView({ chunkId: "chunk_method", sectionPath: "2. Method" }),
      ],
    );

    expect(chunk?.chunkId).toBe("chunk_method");
  });

  it("falls back to a normalized content substring when section path is missing", () => {
    const chunk = resolveCitationChunk(
      makeRetrievalResultView({
        content: "needle sentence from the retrieval result",
        source: {
          documentId: "doc_123",
          sourceFileName: "notes.txt",
        },
      }),
      [
        makeParsedChunkView({
          chunkId: "chunk_hit",
          content:
            "Longer paragraph containing a needle sentence from the retrieval result.",
        }),
      ],
    );

    expect(chunk?.chunkId).toBe("chunk_hit");
  });

  it("returns null when the citation cannot be mapped to one chunk", () => {
    const chunk = resolveCitationChunk(
      makeRetrievalResultView({
        content: "duplicated section",
        source: {
          documentId: "doc_123",
          sourceFileName: "notes.txt",
          sectionPath: "Repeated",
        },
      }),
      [
        makeParsedChunkView({ chunkId: "chunk_a", sectionPath: "Repeated" }),
        makeParsedChunkView({ chunkId: "chunk_b", sectionPath: "Repeated" }),
      ],
    );

    expect(chunk).toBeNull();
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

function makeParsedChunkView(
  overrides: Partial<ReturnType<typeof toParsedChunkView>> = {},
): ReturnType<typeof toParsedChunkView> {
  return {
    chunkId: "document_chunk_1",
    documentId: "doc_123",
    sectionPath: "Intro",
    type: "text",
    content: "Chunk content",
    sourceTitle: "notes.txt",
    ...overrides,
  };
}

function makeRetrievalResultView(
  overrides: Partial<ChatCitationView> = {},
): ChatCitationView {
  return {
    content: "Chunk content",
    chunkType: "text",
    score: 0.9,
    source: {
      documentId: "doc_123",
      sourceFileName: "notes.txt",
      sectionPath: "Intro",
    },
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
