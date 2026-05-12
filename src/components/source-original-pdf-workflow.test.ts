// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useSourceOriginalPdfWorkflow } from "./source-original-pdf-workflow"

vi.mock("react-pdf", () => ({
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: "",
    },
  },
  Document: () => null,
  Page: () => null,
}))

describe("useSourceOriginalPdfWorkflow", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(): void {
        this.callback([], this)
      }

      unobserve() {}
      disconnect() {}
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("loads the PDF module and measures the page width from the container", async () => {
    const { result } = renderPdfWorkflow()
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 672,
    })

    act(() => {
      result.current.containerRef.current = container
    })

    await waitFor(() => {
      expect(result.current.pdfModule).not.toBeNull()
    })
    await waitFor(() => {
      expect(result.current.pageWidth).toBe(640)
    })
  })

  it("loads page aspect ratios and marks the PDF layout as ready", async () => {
    const { result } = renderPdfWorkflow()

    act(() => {
      result.current.handlePdfLoadSuccess({
        numPages: 2,
        getPage: (pageNumber: number) =>
          Promise.resolve({
            getViewport: ({ scale }: { readonly scale: number }) => ({
              width: 640 * scale,
              height: (pageNumber === 1 ? 360 : 960) * scale,
            }),
          }),
      })
    })

    await waitFor(() => {
      expect(result.current.hasLoadedPageLayout).toBe(true)
    })
    expect(result.current.pageCount).toBe(2)
    expect(result.current.getPageAspectRatio(1)).toBe(0.5625)
    expect(result.current.getPageAspectRatio(2)).toBe(1.5)
  })

  it("renders only observed pages when IntersectionObserver is available", async () => {
    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null = null
      readonly rootMargin: string = ""
      readonly scrollMargin: string = ""
      readonly thresholds: readonly number[] = []

      constructor(private readonly callback: IntersectionObserverCallback) {}

      observe(target: Element): void {
        this.callback(
          [
            {
              isIntersecting: target.getAttribute("data-pdf-page-shell") === "2",
              target,
            } as IntersectionObserverEntry,
          ],
          this,
        )
      }

      disconnect() {}
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }
    globalThis.IntersectionObserver = MockIntersectionObserver
    const { result } = renderPdfWorkflow()
    const firstPageShell = document.createElement("div")
    firstPageShell.dataset.pdfPageShell = "1"
    const secondPageShell = document.createElement("div")
    secondPageShell.dataset.pdfPageShell = "2"

    act(() => {
      result.current.registerPageShell(1)(firstPageShell)
      result.current.registerPageShell(2)(secondPageShell)
    })

    await waitFor(() => {
      expect(result.current.shouldRenderPage(2)).toBe(true)
    })
    expect(result.current.shouldRenderPage(1)).toBe(false)
  })
})

function renderPdfWorkflow() {
  return renderHook(() =>
    useSourceOriginalPdfWorkflow({
      file: {
        url: "https://example.com/report.pdf",
        mimeType: "application/pdf",
      },
    }),
  )
}
