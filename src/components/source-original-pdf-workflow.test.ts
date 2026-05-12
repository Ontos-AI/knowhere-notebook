// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sourceOriginalPreviewRequest } from "./source-original-preview-request"
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
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback): number => {
        callback(0)
        return 1
      }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
        ),
      ),
    )
  })

  afterEach(() => {
    sourceOriginalPreviewRequest.clearCacheForTests()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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
      result.current.handlePdfLoadSuccess({
        numPages: 40,
        getPage: () =>
          Promise.resolve({
            getViewport: ({ scale }: { readonly scale: number }) => ({
              width: 640 * scale,
              height: 960 * scale,
            }),
          }),
      })
    })
    act(() => {
      result.current.registerPageShell(1)(firstPageShell)
      result.current.registerPageShell(2)(secondPageShell)
    })

    await waitFor(() => {
      expect(result.current.shouldRenderPage(2)).toBe(true)
    })
    expect(result.current.shouldRenderPage(1)).toBe(true)
    expect(result.current.shouldRenderPage(22)).toBe(true)
    expect(result.current.shouldRenderPage(23)).toBe(false)
  })

  it("keeps a bounded canvas window around the active PDF page", async () => {
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
    const secondPageShell = document.createElement("div")
    secondPageShell.dataset.pdfPageShell = "2"

    act(() => {
      result.current.handlePdfLoadSuccess({
        numPages: 30,
        getPage: () =>
          Promise.resolve({
            getViewport: ({ scale }: { readonly scale: number }) => ({
              width: 640 * scale,
              height: 960 * scale,
            }),
          }),
      })
    })
    act(() => {
      result.current.registerPageShell(2)(secondPageShell)
    })

    await waitFor(() => {
      expect(result.current.shouldRenderPage(22)).toBe(true)
    })
    expect(result.current.shouldRenderPage(23)).toBe(false)
  })

  it("uses the latest intersecting page as the render anchor", async () => {
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
              isIntersecting:
                target.getAttribute("data-pdf-page-shell") === "2" ||
                target.getAttribute("data-pdf-page-shell") === "80",
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
    const earlyPageShell = document.createElement("div")
    earlyPageShell.dataset.pdfPageShell = "2"
    const laterPageShell = document.createElement("div")
    laterPageShell.dataset.pdfPageShell = "80"

    act(() => {
      result.current.handlePdfLoadSuccess({
        numPages: 100,
        getPage: () =>
          Promise.resolve({
            getViewport: ({ scale }: { readonly scale: number }) => ({
              width: 640 * scale,
              height: 960 * scale,
            }),
          }),
      })
    })
    act(() => {
      result.current.registerPageShell(2)(earlyPageShell)
      result.current.registerPageShell(80)(laterPageShell)
    })

    await waitFor(() => {
      expect(result.current.shouldRenderPage(90)).toBe(true)
    })
    expect(result.current.shouldRenderPage(40)).toBe(false)
    expect(result.current.shouldRenderPage(2)).toBe(false)
  })

  it("scrolls the requested PDF page into view after its shell is registered", async () => {
    const scrollIntoView = vi.fn()
    const { result, rerender } = renderPdfWorkflow({
      targetPageNumber: 4,
      targetPageRequestId: 1,
    })
    const pageShell = document.createElement("div")
    pageShell.dataset.pdfPageShell = "4"
    pageShell.scrollIntoView = scrollIntoView

    act(() => {
      result.current.registerPageShell(4)(pageShell)
    })
    rerender({
      targetPageNumber: 4,
      targetPageRequestId: 2,
    })

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      })
    })
  })

  it("renders the requested target page before intersection catches up", () => {
    const { result } = renderPdfWorkflow({
      targetPageNumber: 50,
      targetPageRequestId: 1,
    })

    act(() => {
      result.current.handlePdfLoadSuccess({
        numPages: 100,
        getPage: () =>
          Promise.resolve({
            getViewport: ({ scale }: { readonly scale: number }) => ({
              width: 640 * scale,
              height: 960 * scale,
            }),
          }),
      })
    })

    expect(result.current.shouldRenderPage(50)).toBe(true)
    expect(result.current.shouldRenderPage(60)).toBe(true)
    expect(result.current.shouldRenderPage(70)).toBe(true)
    expect(result.current.shouldRenderPage(71)).toBe(false)
  })
})

function renderPdfWorkflow(
  overrides: Partial<Parameters<typeof useSourceOriginalPdfWorkflow>[0]> = {},
) {
  return renderHook(
    (props: Partial<Parameters<typeof useSourceOriginalPdfWorkflow>[0]>) =>
      useSourceOriginalPdfWorkflow({
        file: {
          url: "https://example.com/report.pdf",
          mimeType: "application/pdf",
        },
        ...props,
      }),
    { initialProps: overrides },
  )
}
