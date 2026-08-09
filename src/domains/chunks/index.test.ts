import { afterEach, describe, expect, it, vi } from "vitest"
import type { DocumentChunk } from "@ontos-ai/knowhere-sdk"
import { Effect } from "effect"

import type { Source } from "@/infrastructure/db/schema"
import {
  getChunkPageParams,
  loadChunkPageForSource,
  loadChunksForSource,
  resolveChunkConnectionTargets,
  resolveCitationChunk,
  resolveCitationChunkByContent,
  toParsedChunkView,
} from "."
import type { ChatCitationView } from "@/domains/chat/types"

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
        page_nums: [1, 2],
        connectTo: [
          {
            target: "parser_image_1",
            relation: "embeds",
            ref: "[images/image-1.jpg]",
            position: { start: 24, end: 44 },
          },
        ],
      },
      assetUrl: null,
    };

    expect(
      toParsedChunkView(chunk, "notes.txt", undefined, {
        assetUrlsByFilePath: {
          "images/image-1.jpg": "https://blob.example/image-1.jpg",
        },
      }),
    ).toEqual({
      chunkId: "document_chunk_1",
      documentId: undefined,
      parserChunkId: "parser_chunk_1",
      sectionPath: "Introduction",
      type: "text",
      content: "Notebook should show parsed text from Knowhere only on demand.",
      summary: "Intro summary",
      keywords: ["notebook", "parsed"],
      pageNums: [1, 2],
      sourceTitle: "notes.txt",
      connections: [
        {
          targetParserChunkId: "parser_image_1",
          relation: "embeds",
          ref: "[images/image-1.jpg]",
          position: { start: 24, end: 44 },
        },
      ],
    });
  });

  it("maps media file paths to persisted parsed-result asset URLs", () => {
    const chunk = makeDocumentChunk({
      id: "document_chunk_image_1",
      chunkId: "parser_image_1",
      chunkType: "image",
      filePath: null,
      metadata: {
        filePath: "images/image-1.jpg",
        summary: "A diagram.",
        page_nums: [3],
      },
      assetUrl: null,
    });

    expect(
      toParsedChunkView(chunk, "manual.pdf", "doc_123", {
        assetUrlsByFilePath: {
          "images/image-1.jpg": "https://blob.example/image-1.jpg",
        },
      }),
    ).toMatchObject({
      chunkId: "document_chunk_image_1",
      parserChunkId: "parser_image_1",
      filePath: "images/image-1.jpg",
      assetUrl: "https://blob.example/image-1.jpg",
      type: "image",
      summary: "A diagram.",
      pageNums: [3],
    });
  });

  it("normalizes current parser metadata shared with demo chunks", () => {
    const chunk = makeDocumentChunk({
      id: "document_chunk_table_1",
      chunkId: "parser_table_1",
      chunkType: "table",
      metadata: {
        file_path: "tables/table-1.html",
        page_nums: [7],
        connect_to: [
          {
            target: "parser_image_1",
            relation: "embeds",
            ref: "[images/image-1.jpg]",
          },
        ],
      },
    });

    expect(
      toParsedChunkView(chunk, "manual.pdf", "doc_123", {
        assetUrlsByFilePath: {
          "tables/table-1.html": "https://blob.example/table-1.html",
        },
      }),
    ).toMatchObject({
      filePath: "tables/table-1.html",
      assetUrl: "https://blob.example/table-1.html",
      pageNums: [7],
      connections: [
        {
          targetParserChunkId: "parser_image_1",
          relation: "embeds",
          ref: "[images/image-1.jpg]",
        },
      ],
    });
  });

  it("maps page-memory chunks to summary-first page chunk views", () => {
    const chunk = {
      ...makeDocumentChunk({
        id: "document_page_1",
        chunkId: "parser_page_1",
        chunkType: "page" as DocumentChunk["chunkType"],
        content: null,
        sectionPath: "Default_Root/manual.pdf-->pages/4-6",
        metadata: {
          summary: "Refund eligibility is summarized across pages 4 to 6.",
          page_nums: [4, 5, 6],
          entities: [{ text: "refund", label: "topic" }],
        },
        assetUrl: "https://assets.example/crop.pdf",
      }),
      contentSource: "summary",
    } as DocumentChunk & { readonly contentSource: string };

    expect(toParsedChunkView(chunk, "manual.pdf", "doc_123")).toMatchObject({
      chunkId: "document_page_1",
      parserChunkId: "parser_page_1",
      type: "page",
      contentSource: "summary",
      content: "Refund eligibility is summarized across pages 4 to 6.",
      readableContent: "Refund eligibility is summarized across pages 4 to 6.",
      pageNums: [4, 5, 6],
      entities: [{ text: "refund", label: "topic" }],
      assetUrl: "https://assets.example/crop.pdf",
    });
  });

  it("maps SDK-normalized page number metadata", () => {
    const chunk = makeDocumentChunk({
      metadata: {
        pageNums: [4, 5, 6],
      },
    });

    expect(toParsedChunkView(chunk, "manual.pdf").pageNums).toEqual([4, 5, 6]);
  });

  it("ignores legacy page number aliases outside metadata", () => {
    const chunk = {
      ...makeDocumentChunk({
        metadata: {
          pageNumbers: [3],
          page_numbers: [4],
        },
      }),
      pageNums: [5],
      page_nums: [6],
    } as DocumentChunk;

    expect(toParsedChunkView(chunk, "manual.pdf").pageNums).toBeUndefined();
  });

  it("ignores malformed page number values", () => {
    const chunk = makeDocumentChunk({
      metadata: {
        page_nums: "15, 16",
      },
    });

    expect(toParsedChunkView(chunk, "manual.pdf").pageNums).toBeUndefined();
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
      pageSize: 200,
      includeAssetUrls: true,
    });
    expect(chunks).toEqual([
      {
        chunkId: "document_chunk_1",
        documentId: "doc_123",
        parserChunkId: "parser_chunk_1",
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

  it("loads all chunk pages and resolves parser chunk connection targets", async () => {
    const listChunks = vi
      .fn()
      .mockResolvedValueOnce({
        chunks: [
          makeDocumentChunk({
            id: "document_text_1",
            chunkId: "parser_text_1",
            content: "Open [images/image-1.jpg] for the diagram.",
            metadata: {
              connectTo: [
                {
                  target: "parser_image_1",
                  relation: "embeds",
                  ref: "[images/image-1.jpg]",
                  position: { start: 5, end: 25 },
                },
                {
                  target: "missing_parser_chunk",
                  relation: "embeds",
                  ref: "[tables/missing.html]",
                },
              ],
            },
          }),
        ],
        pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 },
      })
      .mockResolvedValueOnce({
        chunks: [
          makeDocumentChunk({
            id: "document_image_1",
            chunkId: "parser_image_1",
            chunkType: "image",
            filePath: "images/image-1.jpg",
          }),
        ],
        pagination: { page: 2, pageSize: 1, total: 2, totalPages: 2 },
      });
    const source = makeSource({ knowhereDocumentId: "doc_123" });

    const chunks = await Effect.runPromise(
      loadChunksForSource(
        source,
        { documents: { listChunks } },
        {
          assetUrlsByFilePath: {
            "images/image-1.jpg": "https://blob.example/image-1.jpg",
          },
        },
      ),
    );

    expect(listChunks).toHaveBeenNthCalledWith(1, "doc_123", {
      page: 1,
      pageSize: 200,
      includeAssetUrls: true,
    });
    expect(listChunks).toHaveBeenNthCalledWith(2, "doc_123", {
      page: 2,
      pageSize: 200,
      includeAssetUrls: true,
    });
    expect(chunks[0]?.connections).toEqual([
      {
        targetParserChunkId: "parser_image_1",
        targetChunkId: "document_image_1",
        relation: "embeds",
        ref: "[images/image-1.jpg]",
        position: { start: 5, end: 25 },
      },
      {
        targetParserChunkId: "missing_parser_chunk",
        relation: "embeds",
        ref: "[tables/missing.html]",
      },
    ]);
    expect(chunks[1]?.assetUrl).toBe("https://blob.example/image-1.jpg");
  });
});

describe("loadChunkPageForSource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches only the requested SDK chunk page for infinite scrolling", async () => {
    const listChunks = vi.fn().mockResolvedValue({
      chunks: [
        makeDocumentChunk({
          id: "document_chunk_2",
          chunkId: "parser_chunk_2",
          content: "Second page text",
        }),
      ],
      pagination: { page: 2, pageSize: 50, total: 125, totalPages: 3 },
    });
    const source = makeSource({
      title: "notes.txt",
      knowhereDocumentId: "doc_123",
    });

    const page = await Effect.runPromise(
      loadChunkPageForSource(
        source,
        { documents: { listChunks } },
        { page: 2, pageSize: 50 },
      ),
    );

    expect(listChunks).toHaveBeenCalledWith("doc_123", {
      page: 2,
      pageSize: 50,
      includeAssetUrls: true,
    });
    expect(page.pagination).toEqual({
      page: 2,
      pageSize: 50,
      total: 125,
      totalPages: 3,
    });
    expect(page.chunks).toMatchObject([
      {
        chunkId: "document_chunk_2",
        documentId: "doc_123",
        content: "Second page text",
      },
    ]);
  });

  it("normalizes route query parameters to SDK pagination limits", () => {
    expect(
      getChunkPageParams(
        new URLSearchParams({
          page: "0",
          pageSize: "500",
        }),
      ),
    ).toEqual({
      page: 1,
      pageSize: 200,
    });
  });

  it("resolves connection targets across already-loaded infinite pages", () => {
    const chunks = resolveChunkConnectionTargets([
      makeParsedChunkView({
        chunkId: "text_1",
        parserChunkId: "parser_text_1",
        connections: [
          {
            targetParserChunkId: "parser_image_1",
            relation: "embeds",
          },
        ],
      }),
      makeParsedChunkView({
        chunkId: "image_1",
        parserChunkId: "parser_image_1",
        type: "image",
      }),
    ]);

    expect(chunks[0]?.connections?.[0]?.targetChunkId).toBe("image_1");
  });
});

describe("resolveCitationChunk", () => {
  it("prefers the citation excerpt over a broad section path", () => {
    const chunk = resolveCitationChunk(
      makeRetrievalResultView({
        content: "exact sentence from the second chunk",
        source: {
          documentId: "doc_123",
          sourceFileName: "notes.txt",
          sectionPath: "Shared Section",
        },
      }),
      [
        makeParsedChunkView({
          chunkId: "chunk_first",
          sectionPath: "Shared Section",
          content: "different sentence from the first chunk",
        }),
        makeParsedChunkView({
          chunkId: "chunk_second",
          sectionPath: "More Specific Section",
          content: "prefix exact sentence from the second chunk suffix",
        }),
      ],
    );

    expect(chunk?.chunkId).toBe("chunk_second");
  });

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

  it("resolves a snippet-window citation to its page chunk by chunkId", () => {
    const chunk = resolveCitationChunk(
      makeRetrievalResultView({
        content: "…window around CHEUNG Hon-lam Gordon…",
        chunkId: "parser_page_1",
        source: {
          documentId: "doc_123",
          sourceFileName: "directory.pdf",
          sectionPath: "Page 3",
        },
      }),
      [
        makeParsedChunkView({
          chunkId: "row_page_1",
          parserChunkId: "parser_page_1",
          type: "page",
          sectionPath: "Page 3",
          content: "CHEUNG Hon-lam Gordon 2835 2147",
        }),
        makeParsedChunkView({
          chunkId: "row_page_2",
          parserChunkId: "parser_page_2",
          type: "page",
          sectionPath: "Page 4",
          content: "YUEN Chun-cheung Gordon 3752 8030",
        }),
      ],
    );

    expect(chunk?.chunkId).toBe("row_page_1");
  });

  it("prefers a chunkId match over a content excerpt match on a different chunk", () => {
    const chunk = resolveCitationChunk(
      makeRetrievalResultView({
        content: "exact sentence from the second chunk",
        chunkId: "parser_first",
        source: {
          documentId: "doc_123",
          sourceFileName: "notes.txt",
          sectionPath: "Shared Section",
        },
      }),
      [
        makeParsedChunkView({
          chunkId: "chunk_first",
          parserChunkId: "parser_first",
          sectionPath: "Shared Section",
          content: "different sentence from the first chunk",
        }),
        makeParsedChunkView({
          chunkId: "chunk_second",
          parserChunkId: "parser_second",
          sectionPath: "More Specific Section",
          content: "prefix exact sentence from the second chunk suffix",
        }),
      ],
    );

    expect(chunk?.chunkId).toBe("chunk_first");
  });
});

describe("resolveCitationChunkByContent", () => {
  it("resolves by chunkId when the loaded chunk set is partial", () => {
    const chunk = resolveCitationChunkByContent(
      makeRetrievalResultView({
        content: "…snippet window without an excerpt match…",
        chunkId: "parser_page_1",
        source: {
          documentId: "doc_123",
          sourceFileName: "directory.pdf",
          sectionPath: "Page 3",
        },
      }),
      [
        makeParsedChunkView({
          chunkId: "row_page_1",
          parserChunkId: "parser_page_1",
          type: "page",
          content: "CHEUNG Hon-lam Gordon 2835 2147",
        }),
      ],
    );

    expect(chunk?.chunkId).toBe("row_page_1");
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
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}
