// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { SWRConfig, unstable_serialize } from "swr";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { useWorkspaceCitationFocus } from "./workspace-citation-focus";
import type { ChatCitationView } from "@/domains/chat/types";
import type { ParsedChunkView } from "@/domains/chunks/types";
import type { SourceView } from "@/domains/sources/types";

const readySource: SourceView = {
  id: "source_1",
  title: "Contract.pdf",
  mimeType: "application/pdf",
  status: "ready",
  documentId: "document_1",
};

const citation: ChatCitationView = {
  chunkType: "text",
  score: 0.94,
  content: "Revenue grew in the quarter.",
  source: {
    documentId: "document_1",
    sourceFileName: "Contract.pdf",
    sectionPath: "Revenue",
  },
};

const prefetchedChunk: ParsedChunkView = {
  chunkId: "chunk_1",
  documentId: "document_1",
  sectionPath: "Revenue",
  type: "text",
  content: "Revenue grew in the quarter.",
  sourceTitle: "Contract.pdf",
};

describe("useWorkspaceCitationFocus", () => {
  it("loads all chunks, selects the source, and focuses the cited chunk", async () => {
    const fetchChunks = vi.fn(async () => [prefetchedChunk]);
    const selectSource = vi.fn();

    const { result } = renderHook(() =>
      useWorkspaceCitationFocus({
        fetchChunks,
        onSelectSource: selectSource,
        selectedSourceId: null,
        sources: [readySource],
      }),
      { wrapper: createSWRWrapper },
    );

    await act(async () => {
      await result.current.handleCitationClick(citation, "message_1:0");
    });

    expect(fetchChunks).toHaveBeenCalledWith("source_1");
    expect(selectSource).toHaveBeenCalledWith("source_1");
    expect(result.current.prefetchedChunksBySourceId).toEqual({
      source_1: [prefetchedChunk],
    });
    expect(result.current.focusedChunk).toEqual({
      chunkId: "chunk_1",
      requestId: 2,
    });
    expect(result.current.pendingCitationId).toBeNull();
  });

  it("clears prefetched chunks and focus when selecting a different source", () => {
    const selectSource = vi.fn();
    const otherSource: SourceView = {
      id: "source_2",
      title: "Other.pdf",
      mimeType: "application/pdf",
      status: "ready",
      documentId: "document_2",
    };
    const { result } = renderHook(() =>
      useWorkspaceCitationFocus({
        fetchChunks: vi.fn(async () => []),
        initialPrefetchedChunksBySourceId: { source_1: [prefetchedChunk] },
        onSelectSource: selectSource,
        selectedSourceId: "source_2",
        sources: [readySource, otherSource],
      }),
      { wrapper: createSWRWrapper },
    );

    act(() => {
      result.current.handleSourceSelected("source_1");
    });

    expect(selectSource).toHaveBeenCalledWith("source_1");
    expect(result.current.prefetchedChunksBySourceId).toEqual({});
    expect(result.current.focusedChunk).toEqual({
      chunkId: null,
      requestId: 1,
    });
  });

  it("keeps prefetched chunks when reselecting the selected source", () => {
    const selectSource = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceCitationFocus({
        fetchChunks: vi.fn(async () => []),
        initialPrefetchedChunksBySourceId: { source_1: [prefetchedChunk] },
        onSelectSource: selectSource,
        selectedSourceId: "source_1",
        sources: [readySource],
      }),
      { wrapper: createSWRWrapper },
    );

    act(() => {
      result.current.handleSourceSelected("source_1");
    });

    expect(selectSource).toHaveBeenCalledWith("source_1");
    expect(result.current.prefetchedChunksBySourceId).toEqual({
      source_1: [prefetchedChunk],
    });
    expect(result.current.focusedChunk).toEqual({
      chunkId: null,
      requestId: 1,
    });
  });

  it("opens the source without fetching chunks when the citation has no exact target hint", async () => {
    const fetchChunks = vi.fn(async () => [prefetchedChunk]);
    const selectSource = vi.fn();
    const sourceOnlyCitation: ChatCitationView = {
      chunkType: "text",
      score: 0.5,
      source: {
        documentId: "document_1",
        sourceFileName: "Contract.pdf",
        sectionPath: "Root",
      },
    };

    const { result } = renderHook(() =>
      useWorkspaceCitationFocus({
        fetchChunks,
        initialPrefetchedChunksBySourceId: {
          source_1: [prefetchedChunk],
        },
        onSelectSource: selectSource,
        selectedSourceId: null,
        sources: [readySource],
      }),
      { wrapper: createSWRWrapper },
    );

    await act(async () => {
      await result.current.handleCitationClick(
        sourceOnlyCitation,
        "message_1:0",
      );
    });

    expect(fetchChunks).not.toHaveBeenCalled();
    expect(selectSource).toHaveBeenLastCalledWith("source_1");
    expect(result.current.prefetchedChunksBySourceId).toEqual({});
    expect(result.current.citationListViewRequestId).toBe(1);
    expect(result.current.focusedChunk.chunkId).toBeNull();
    expect(result.current.pendingCitationId).toBeNull();
  });

  it("focuses page-asset citations through the loaded page chunk", async () => {
    const pageChunk: ParsedChunkView = {
      chunkId: "page_4",
      documentId: "document_1",
      type: "page",
      content: "Page 4 summary",
      sourceTitle: "Contract.pdf",
      pageAssets: [
        {
          pageNumber: 4,
          assetUrl: "https://assets.example/page-000004.png",
          contentType: "image/png",
        },
      ],
    };
    const fetchChunks = vi.fn(async () => [pageChunk]);
    const selectSource = vi.fn();
    const pageAssetSource: SourceView = {
      ...readySource,
      documentPresentation: { kind: "page-assets", pageCount: 8 },
    };
    const pageCitation: ChatCitationView = {
      chunkType: "page",
      score: 0.9,
      pageCitationAssetUrl: "https://assets.example/page-000004.png",
      pageCitationPageNumber: 4,
      source: {
        documentId: "document_1",
        sourceFileName: "Contract.pdf",
        sectionPath: "Page 4",
      },
    };

    const { result } = renderHook(() =>
      useWorkspaceCitationFocus({
        fetchChunks,
        onSelectSource: selectSource,
        selectedSourceId: null,
        sources: [pageAssetSource],
      }),
      { wrapper: createSWRWrapper },
    );

    await act(async () => {
      await result.current.handleCitationClick(pageCitation, "message_1:0");
    });

    expect(fetchChunks).toHaveBeenCalledWith("source_1", {
      chunkType: "page",
      untilPageNumber: 4,
    });
    expect(selectSource).toHaveBeenCalledWith("source_1");
    expect(result.current.focusedChunk.chunkId).toBe("page_4");
    expect(result.current.focusedPage).toEqual({
      pageNumber: 4,
      requestId: 1,
      citationId: "message_1:0",
    });
    expect(result.current.citationListViewRequestId).toBe(1);
  });

  it("uses cached SWR pages for file B while viewing A without loading all chunk types", async () => {
    const pageChunk: ParsedChunkView = {
      chunkId: "page_4",
      documentId: "document_1",
      type: "page",
      content: "Page 4 summary",
      sourceTitle: "Contract.pdf",
      pageAssets: [
        {
          pageNumber: 4,
          assetUrl: "https://assets.example/page-000004.png",
          contentType: "image/png",
        },
      ],
    };
    const fetchChunks = vi.fn(async () => [pageChunk]);
    const selectSource = vi.fn();
    const viewingSource: SourceView = {
      id: "source_2",
      title: "Other.pdf",
      mimeType: "application/pdf",
      status: "ready",
      documentId: "document_2",
    };
    const pageAssetSource: SourceView = {
      ...readySource,
      documentPresentation: { kind: "page-assets", pageCount: 8 },
    };
    const pageCitation: ChatCitationView = {
      chunkType: "page",
      score: 0.9,
      pageCitationAssetUrl: "https://assets.example/page-000004.png",
      pageCitationPageNumber: 4,
      source: {
        documentId: "document_1",
        sourceFileName: "Contract.pdf",
        sectionPath: "Page 4",
      },
    };
    const cache = new Map([
      [
        unstable_serialize(["source-chunks", "source_1", 1]),
        {
          data: {
            chunks: [pageChunk],
            pagination: {
              page: 1,
              pageSize: 50,
              total: 1,
              totalPages: 1,
            },
          },
        },
      ],
    ]);

    const { result } = renderHook(
      () =>
        useWorkspaceCitationFocus({
          fetchChunks,
          onSelectSource: selectSource,
          selectedSourceId: "source_2",
          sources: [pageAssetSource, viewingSource],
        }),
      {
        wrapper: ({ children }: { readonly children: ReactNode }) =>
          React.createElement(
            SWRConfig,
            { value: { provider: () => cache } },
            children,
          ),
      },
    );

    await act(async () => {
      await result.current.handleCitationClick(pageCitation, "message_1:0");
    });

    expect(fetchChunks).not.toHaveBeenCalled();
    expect(selectSource).toHaveBeenCalledWith("source_1");
    expect(result.current.focusedChunk.chunkId).toBe("page_4");
    expect(result.current.focusedPage.pageNumber).toBe(4);
    expect(result.current.focusedPage.citationId).toBe("message_1:0");
  });

  it("loads only page-type chunks when the tree asks for a full page-asset source", async () => {
    const pageChunk: ParsedChunkView = {
      chunkId: "page_4",
      documentId: "document_1",
      type: "page",
      content: "Page 4 summary",
      sourceTitle: "Contract.pdf",
      pageAssets: [
        {
          pageNumber: 4,
          assetUrl: "https://assets.example/page-000004.png",
          contentType: "image/png",
        },
      ],
    };
    const fetchChunks = vi.fn(async () => [pageChunk]);
    const pageAssetSource: SourceView = {
      ...readySource,
      documentPresentation: { kind: "page-assets", pageCount: 8 },
    };

    const { result } = renderHook(
      () =>
        useWorkspaceCitationFocus({
          fetchChunks,
          onSelectSource: vi.fn(),
          selectedSourceId: "source_1",
          sources: [pageAssetSource],
        }),
      { wrapper: createSWRWrapper },
    );

    await act(async () => {
      result.current.handleLoadAllChunks();
    });

    await waitFor(() => {
      expect(fetchChunks).toHaveBeenCalledWith("source_1", { chunkType: "page" });
    });
    expect(result.current.prefetchedChunksBySourceId).toEqual({
      source_1: [pageChunk],
    });
  });

  it("reuses cached chunks for a different source without refetching", async () => {
    const fetchChunks = vi.fn(async () => [prefetchedChunk]);
    const selectSource = vi.fn();
    const otherSource: SourceView = {
      id: "source_2",
      title: "Other.pdf",
      mimeType: "application/pdf",
      status: "ready",
      documentId: "document_2",
    };

    const { result } = renderHook(() =>
      useWorkspaceCitationFocus({
        fetchChunks,
        initialPrefetchedChunksBySourceId: {
          source_1: [prefetchedChunk],
        },
        onSelectSource: selectSource,
        selectedSourceId: "source_2",
        sources: [readySource, otherSource],
      }),
      { wrapper: createSWRWrapper },
    );

    await act(async () => {
      await result.current.handleCitationClick(citation, "message_1:0");
    });

    expect(fetchChunks).not.toHaveBeenCalled();
    expect(selectSource).toHaveBeenLastCalledWith("source_1");
    expect(result.current.focusedChunk.chunkId).toBe("chunk_1");
    expect(Object.keys(result.current.prefetchedChunksBySourceId)).toContain(
      "source_1",
    );
  });

  it("focuses a second citation on the selected source without refetching", async () => {
    const secondChunk: ParsedChunkView = {
      chunkId: "chunk_2",
      documentId: "document_1",
      sectionPath: "Costs",
      type: "text",
      content: "Costs rose in the quarter.",
      sourceTitle: "Contract.pdf",
    };
    const secondCitation: ChatCitationView = {
      chunkType: "text",
      score: 0.9,
      content: "Costs rose in the quarter.",
      source: {
        documentId: "document_1",
        sourceFileName: "Contract.pdf",
        sectionPath: "Costs",
      },
    };
    const fetchChunks = vi.fn(async () => [prefetchedChunk, secondChunk]);
    const selectSource = vi.fn();

    const { result } = renderHook(() =>
      useWorkspaceCitationFocus({
        fetchChunks,
        onSelectSource: selectSource,
        selectedSourceId: "source_1",
        sources: [readySource],
      }),
      { wrapper: createSWRWrapper },
    );

    await act(async () => {
      await result.current.handleCitationClick(citation, "message_1:0");
    });
    await act(async () => {
      await result.current.handleCitationClick(secondCitation, "message_1:1");
    });

    expect(fetchChunks).toHaveBeenCalledTimes(1);
    expect(fetchChunks).toHaveBeenCalledWith("source_1");
    expect(result.current.focusedChunk.chunkId).toBe("chunk_2");
    expect(result.current.focusedPage.citationId).toBe("message_1:1");
  });
});

function createSWRWrapper({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return React.createElement(
    SWRConfig,
    { value: { provider: () => new Map() } },
    children,
  );
}
