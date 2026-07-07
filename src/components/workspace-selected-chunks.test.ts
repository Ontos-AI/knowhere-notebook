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

  it("treats a processing chunk page as a loading state", async () => {
    fetchChunkPageMock.mockResolvedValue({
      chunks: [],
      isProcessing: true,
      message: "Source parsed snapshot is still being prepared.",
      pagination: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 0,
      },
    });

    const { result } = renderHook(
      () =>
        useWorkspaceSelectedChunks({
          selectedSourceId: "source_1",
          sources: [readySource],
          prefetchedChunksBySourceId: {},
        }),
      { wrapper: createSWRWrapper },
    );

    await waitFor(() =>
      expect(result.current.selectedChunksMessage).toBe(
        "Source parsed snapshot is still being prepared.",
      ),
    );
    expect(result.current.isSelectedChunksLoading).toBe(true);
    expect(result.current.selectedChunks).toEqual([]);
  });

  it("surfaces unavailable chunk messages without a loading state", async () => {
    fetchChunkPageMock.mockResolvedValue({
      chunks: [],
      isUnavailable: true,
      message:
        "Source is unavailable. The parsed document is not available locally and could not be loaded from Knowhere.",
      pagination: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 0,
      },
    });

    const { result } = renderHook(
      () =>
        useWorkspaceSelectedChunks({
          selectedSourceId: "source_1",
          sources: [readySource],
          prefetchedChunksBySourceId: {},
        }),
      { wrapper: createSWRWrapper },
    );

    await waitFor(() =>
      expect(result.current.selectedChunksMessage).toBe(
        "Source is unavailable. The parsed document is not available locally and could not be loaded from Knowhere.",
      ),
    );
    expect(result.current.isSelectedChunksLoading).toBe(false);
    expect(result.current.selectedChunks).toEqual([]);
  });

  it("does not fetch chunk pages for page-asset sources", () => {
    const pageAssetSource: SourceView = {
      ...readySource,
      documentPresentation: { kind: "page-assets", pageCount: 4 },
    };

    const { result } = renderHook(
      () =>
        useWorkspaceSelectedChunks({
          selectedSourceId: "source_1",
          sources: [pageAssetSource],
          prefetchedChunksBySourceId: {},
        }),
      { wrapper: createSWRWrapper },
    );

    expect(result.current.selectedSource?.id).toBe("source_1");
    expect(result.current.selectedChunks).toEqual([]);
    expect(result.current.isSelectedChunksLoading).toBe(false);
    expect(fetchChunkPageMock).not.toHaveBeenCalled();
  });

  it("requests a source refresh after loading an unlocalized remote source", async () => {
    const onRemoteSourceChunksLoaded = vi.fn();
    const remoteSource: SourceView = {
      ...readySource,
      id: "knowhere-doc:default:doc_remote",
      kind: "remote",
      documentId: "doc_remote",
      excludedFromQuery: false,
    };
    fetchChunkPageMock.mockResolvedValue({
      chunks: [
        {
          chunkId: "chunk_1",
          type: "text",
          content: "Remote content",
          sourceTitle: "Remote.pdf",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
      },
    });

    const { rerender } = renderHook(
      (input: {
        readonly onRemoteSourceChunksLoaded: (sourceId: string) => void;
      }) =>
        useWorkspaceSelectedChunks({
          selectedSourceId: "knowhere-doc:default:doc_remote",
          sources: [remoteSource],
          prefetchedChunksBySourceId: {},
          onRemoteSourceChunksLoaded: input.onRemoteSourceChunksLoaded,
        }),
      {
        initialProps: { onRemoteSourceChunksLoaded },
        wrapper: createSWRWrapper,
      },
    );

    await waitFor(() =>
      expect(onRemoteSourceChunksLoaded).toHaveBeenCalledWith(
        "knowhere-doc:default:doc_remote",
      ),
    );

    rerender({ onRemoteSourceChunksLoaded });
    expect(onRemoteSourceChunksLoaded).toHaveBeenCalledTimes(1);
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
