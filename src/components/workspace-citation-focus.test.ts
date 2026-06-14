// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";
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
