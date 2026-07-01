// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { useWorkspaceSelectedChunks } from "./workspace-selected-chunks";
import type { ParsedChunkView } from "@/domains/chunks/types";
import type { SourceView } from "@/domains/sources/types";

const fetchChunkPageMock = vi.hoisted(() => vi.fn());

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    fetchChunkPage: fetchChunkPageMock,
  },
}));

const readySource: SourceView = {
  id: "source_1",
  title: "lecture.pdf",
  mimeType: "application/pdf",
  status: "ready",
  chunkCount: 1,
};

describe("useWorkspaceSelectedChunks", () => {
  beforeEach(() => {
    fetchChunkPageMock.mockReset();
    fetchChunkPageMock.mockResolvedValue({
      chunks: [],
      pagination: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 1,
      },
    });
  });

  it("returns prefetched chunks while checking the visible page for media", async () => {
    const { result } = renderHook(
      () =>
        useWorkspaceSelectedChunks({
          selectedSourceId: "source_1",
          sources: [readySource],
          prefetchedChunksBySourceId: {
            source_1: [
              {
                chunkId: "chunk_1",
                type: "text",
                content: "Prefetched content",
                sourceTitle: "lecture.pdf",
              },
            ],
          },
        }),
      { wrapper: createSWRWrapper },
    );

    await waitFor(() =>
      expect(fetchChunkPageMock).toHaveBeenCalledWith("source_1", 1),
    );
    expect(result.current.selectedSource?.id).toBe("source_1");
    expect(result.current.selectedChunks.map((chunk) => chunk.chunkId)).toEqual([
      "chunk_1",
    ]);
    expect(result.current.hasMoreSelectedChunks).toBe(false);
    expect(result.current.isSelectedChunksLoading).toBe(false);
  });

  it("keeps visible page asset URLs when full-tree chunks arrive without media", async () => {
    const pagedImageChunk: ParsedChunkView = {
      chunkId: "image_1",
      type: "image",
      content: "Image summary",
      sourceTitle: "logo.png",
      assetUrl: "https://blob.example/chunk-assets/image-1.png",
    };
    const structureOnlyImageChunk: ParsedChunkView = {
      chunkId: "image_1",
      type: "image",
      content: "Image summary",
      sourceTitle: "logo.png",
    };
    fetchChunkPageMock.mockResolvedValue({
      chunks: [pagedImageChunk],
      pagination: {
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
      },
    });

    const { result, rerender } = renderHook(
      (input: {
        readonly prefetchedChunksBySourceId: Readonly<
          Record<string, ParsedChunkView[]>
        >;
      }) =>
        useWorkspaceSelectedChunks({
          selectedSourceId: "source_1",
          sources: [readySource],
          prefetchedChunksBySourceId: input.prefetchedChunksBySourceId,
        }),
      {
        initialProps: { prefetchedChunksBySourceId: {} },
        wrapper: createSWRWrapper,
      },
    );

    await waitFor(() =>
      expect(result.current.selectedChunks[0]?.assetUrl).toBe(
        "https://blob.example/chunk-assets/image-1.png",
      ),
    );

    rerender({
      prefetchedChunksBySourceId: {
        source_1: [structureOnlyImageChunk],
      },
    });

    expect(result.current.selectedChunks[0]).toMatchObject({
      chunkId: "image_1",
      assetUrl: "https://blob.example/chunk-assets/image-1.png",
    });
  });

  it("returns an empty chunk list when no source is selected", () => {
    const { result } = renderHook(
      () =>
        useWorkspaceSelectedChunks({
          selectedSourceId: null,
          sources: [readySource],
          prefetchedChunksBySourceId: {},
        }),
      { wrapper: createSWRWrapper },
    );

    expect(result.current.selectedSource).toBeUndefined();
    expect(result.current.selectedChunks).toEqual([]);
    expect(result.current.hasMoreSelectedChunks).toBe(false);
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
