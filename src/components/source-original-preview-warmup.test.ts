// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { sourceOriginalPreviewRequest } from "./source-original-preview-request"
import { useSourceOriginalPreviewWarmup } from "./source-original-preview-warmup"

describe("useSourceOriginalPreviewWarmup", () => {
  afterEach(() => {
    sourceOriginalPreviewRequest.clearCacheForTests()
    vi.unstubAllGlobals()
  })

  it("predownloads previewable original PDFs when a source is selected", async () => {
    const fetchOriginal = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
      ),
    )
    vi.stubGlobal("fetch", fetchOriginal)

    renderHook(() =>
      useSourceOriginalPreviewWarmup({
        sourceTitle: "report.pdf",
        file: {
          url: "https://example.com/report.pdf",
          mimeType: "application/pdf",
        },
      }),
    )

    await waitFor(() => {
      expect(fetchOriginal).toHaveBeenCalledTimes(1)
    })
    await sourceOriginalPreviewRequest.getArrayBuffer(
      "https://example.com/report.pdf",
      new AbortController().signal,
    )
    expect(fetchOriginal).toHaveBeenCalledTimes(1)
  })

  it("does not predownload unsupported originals", async () => {
    const fetchOriginal = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal("fetch", fetchOriginal)

    renderHook(() =>
      useSourceOriginalPreviewWarmup({
        sourceTitle: "legacy.doc",
        file: {
          url: "https://example.com/legacy.doc",
          mimeType: "application/msword",
        },
      }),
    )

    await Promise.resolve()

    expect(fetchOriginal).not.toHaveBeenCalled()
  })

  it("does not predownload browser-viewed public PDFs", async () => {
    const fetchOriginal = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal("fetch", fetchOriginal)

    renderHook(() =>
      useSourceOriginalPreviewWarmup({
        sourceTitle: "demo.pdf",
        file: {
          url: "https://example.com/demo.pdf",
          mimeType: "application/pdf",
          pdfPreviewMode: "browser",
        },
      }),
    )

    await Promise.resolve()

    expect(fetchOriginal).not.toHaveBeenCalled()
  })
})
