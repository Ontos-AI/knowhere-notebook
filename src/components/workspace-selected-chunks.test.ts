// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import { useWorkspaceSelectedChunks } from "./workspace-selected-chunks";
import type { SourceView } from "@/domains/sources/types";

const readySource: SourceView = {
  id: "source_1",
  title: "lecture.pdf",
  mimeType: "application/pdf",
  status: "ready",
  chunkCount: 1,
};

describe("useWorkspaceSelectedChunks", () => {
  it("returns prefetched chunks without asking SWR to page the source", () => {
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

    expect(result.current.selectedSource?.id).toBe("source_1");
    expect(result.current.selectedChunks.map((chunk) => chunk.chunkId)).toEqual([
      "chunk_1",
    ]);
    expect(result.current.hasMoreSelectedChunks).toBe(false);
    expect(result.current.isSelectedChunksLoading).toBe(false);
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
