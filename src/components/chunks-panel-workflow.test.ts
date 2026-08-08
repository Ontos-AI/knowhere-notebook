// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import type { UIEvent } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceOriginalFileView } from "@/domains/sources/types"
import { useChunksPanelWorkflow } from "./chunks-panel-workflow"

type ChunksPanelWorkflowInput = Parameters<typeof useChunksPanelWorkflow>[0]

describe("useChunksPanelWorkflow", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback): number => {
        callback(0)
        return 1
      }),
    )
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("returns from the original preview to parsed chunks when a citation is focused", async () => {
    const chunks = [makeChunk({ chunkId: "chunk_1" })]
    const selectedSourceFile = makeOriginalFile()
    const input = makeInput({
      chunks,
      selectedSource: "report.doc",
      selectedSourceFile,
    })
    const { result, rerender } = renderHook(
      (props: ChunksPanelWorkflowInput) => useChunksPanelWorkflow(props),
      { initialProps: input },
    )

    act(() => {
      result.current.handleOriginalViewSelected()
    })

    expect(result.current.visibleView).toBe("original")

    rerender({
      ...input,
      focusedChunkId: "chunk_1",
      focusedChunkRequestId: 1,
    })

    await waitFor(() => {
      expect(result.current.visibleView).toBe("parsed")
    })
    expect(result.current.activeFocusedChunkId).toBe("chunk_1")
    expect(result.current.visibleChunks[0]?.chunkId).toBe("chunk_1")
  })

  it("records local reference focus and shows only the referenced chunk", () => {
    const { result } = renderHook(() =>
      useChunksPanelWorkflow(
        makeInput({
          chunks: [
            makeChunk({ chunkId: "chunk_1" }),
            makeChunk({ chunkId: "chunk_2" }),
          ],
          selectedSource: "manual.pdf",
        }),
      ),
    )

    act(() => {
      result.current.requestChunkFocus("chunk_2")
    })

    expect(result.current.activeFocusedChunkId).toBe("chunk_2")
    expect(result.current.visibleChunks.map((chunk) => chunk.chunkId)).toEqual([
      "chunk_2",
    ])
  })

  it("requests another page only when the visible parsed viewport nears the bottom", () => {
    const onLoadMore = vi.fn()
    const { result } = renderHook(() =>
      useChunksPanelWorkflow(
        makeInput({
          chunks: [makeChunk()],
          hasMoreChunks: true,
          onLoadMore,
        }),
      ),
    )

    act(() => {
      result.current.handleViewportScroll(
        makeScrollEvent({
          clientHeight: 720,
          scrollHeight: 1400,
          scrollTop: 100,
        }),
      )
      result.current.handleViewportScroll(
        makeScrollEvent({
          clientHeight: 0,
          scrollHeight: 0,
          scrollTop: 0,
        }),
      )
    })

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})

function makeInput(
  overrides: Partial<ChunksPanelWorkflowInput> = {},
): ChunksPanelWorkflowInput {
  return {
    chunks: [],
    selectedSource: null,
    selectedSourceFile: null,
    focusedChunkId: null,
    focusedChunkRequestId: 0,
    isLoading: false,
    isLoadingMore: false,
    hasMoreChunks: false,
    ...overrides,
  }
}

function makeChunk(overrides: Partial<ParsedChunkView> = {}): ParsedChunkView {
  return {
    chunkId: "chunk_1",
    type: "text",
    content: "Parsed content.",
    sourceTitle: "manual.pdf",
    ...overrides,
  }
}

function makeOriginalFile(): SourceOriginalFileView {
  return {
    url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/report.doc",
    mimeType: "application/msword",
  }
}

function makeScrollEvent(metrics: {
  readonly clientHeight: number
  readonly scrollHeight: number
  readonly scrollTop: number
}): UIEvent<HTMLDivElement> {
  return {
    currentTarget: metrics as HTMLDivElement,
  } as UIEvent<HTMLDivElement>
}
