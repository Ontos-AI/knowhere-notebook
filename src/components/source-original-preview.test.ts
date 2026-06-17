// @vitest-environment jsdom
import React, { useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SourceOriginalPreview } from "./source-original-preview";
import { sourceOriginalPreviewRequest } from "./source-original-preview-request";

const pdfPageRenderLog: number[] = [];
const pdfPageWidthLog: number[] = [];
const pdfPageDevicePixelRatioLog: Array<number | undefined> = [];
const docxRenderOptionsLog: unknown[] = [];
const mammothConvertLog: unknown[] = [];
let pdfDocumentPageCount = 35;
let pdfVisiblePageNumbers: ReadonlySet<number> = new Set([1, 2]);
let shouldDelayPdfChildrenUntilLoad = false;
let shouldDelayPdfPageLoadSuccess = false;
let shouldRejectDocxPreviewRender = false;
let pdfPageHeight = 360;
let pdfPageViewportWidth = 640;
let pdfPageViewportHeight = 360;
let pdfContainerClientWidth = 0;
type TestIntersectionObserver = {
  emit(entries: ReadonlyArray<{
    readonly isIntersecting: boolean;
    readonly target: Element;
  }>): void;
};

let observedPdfTargets: Element[] = [];
let latestObserver: TestIntersectionObserver | null = null;

vi.mock("react-pdf", () => ({
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: "",
    },
  },
  Document({
    children,
    onLoadSuccess,
  }: {
    readonly children: ReactNode;
    readonly onLoadSuccess: (input: {
      readonly numPages: number;
      readonly getPage: (pageNumber: number) => Promise<{
        readonly getViewport: (input: { readonly scale: number }) => {
          readonly width: number;
          readonly height: number;
        };
      }>;
    }) => void;
  }) {
    const [isLoaded, setIsLoaded] = React.useState(
      !shouldDelayPdfChildrenUntilLoad,
    );

    useEffect(() => {
      onLoadSuccess({
        numPages: pdfDocumentPageCount,
        getPage: () =>
          Promise.resolve({
            getViewport: ({ scale }) => ({
              width: pdfPageViewportWidth * scale,
              height: pdfPageViewportHeight * scale,
            }),
          }),
      });
      if (shouldDelayPdfChildrenUntilLoad) setIsLoaded(true);
    }, [onLoadSuccess]);

    return React.createElement(
      "div",
      { "data-testid": "pdf-document" },
      isLoaded ? children : null,
    );
  },
  Page({
    pageNumber,
    width,
    devicePixelRatio,
    onLoadSuccess,
  }: {
    readonly pageNumber: number;
    readonly width: number;
    readonly devicePixelRatio?: number;
    readonly onLoadSuccess?: (page: {
      readonly height: number;
      readonly width: number;
    }) => void;
  }) {
    useEffect(() => {
      if (shouldDelayPdfPageLoadSuccess) return;
      onLoadSuccess?.({ height: pdfPageHeight, width: 640 });
    }, [onLoadSuccess]);

    pdfPageRenderLog.push(pageNumber);
    pdfPageWidthLog.push(width);
    pdfPageDevicePixelRatioLog.push(devicePixelRatio);
    return React.createElement("div", {
      "data-testid": `pdf-page-${pageNumber}`,
    });
  },
}));

vi.mock("docx-preview", () => ({
  renderAsync: vi.fn(
    (
      _data: ArrayBuffer,
      _container: HTMLElement,
      _styleContainer: HTMLElement | undefined,
      options: unknown,
    ) => {
      docxRenderOptionsLog.push(options);
      return shouldRejectDocxPreviewRender
        ? Promise.reject(new Error("docx-preview failed"))
        : Promise.resolve();
    },
  ),
}));

vi.mock("mammoth", () => ({
  default: {
    convertToHtml: vi.fn((input: unknown) => {
      mammothConvertLog.push(input);
      return Promise.resolve({
        value: "<h1>Fallback DOCX</h1><script>alert('x')</script>",
        messages: [],
      });
    }),
  },
}));

describe("SourceOriginalPreview", () => {
  beforeEach(() => {
    pdfPageRenderLog.length = 0;
    pdfPageWidthLog.length = 0;
    pdfPageDevicePixelRatioLog.length = 0;
    docxRenderOptionsLog.length = 0;
    mammothConvertLog.length = 0;
    pdfDocumentPageCount = 35;
    pdfVisiblePageNumbers = new Set([1, 2]);
    shouldDelayPdfChildrenUntilLoad = false;
    shouldDelayPdfPageLoadSuccess = false;
    pdfPageHeight = 360;
    pdfPageViewportWidth = 640;
    pdfPageViewportHeight = 360;
    pdfContainerClientWidth = 672;
    shouldRejectDocxPreviewRender = false;
    observedPdfTargets = [];
    latestObserver = null;
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {
        // The production component should still measure once synchronously;
        // ResizeObserver callbacks are not guaranteed to fire before first paint.
      }
      unobserve() {}
      disconnect() {}
    };
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return pdfContainerClientWidth;
      },
    });
    Object.defineProperty(Element.prototype, "clientWidth", {
      configurable: true,
      get() {
        return pdfContainerClientWidth;
      },
    });
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 1,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
        ),
      ),
    );
    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null = null;
      readonly rootMargin: string = "";
      readonly scrollMargin: string = "";
      readonly thresholds: readonly number[] = [];

      constructor(
        private readonly callback: IntersectionObserverCallback,
      ) {
        latestObserver = {
          emit: (entries) => this.emit(entries),
        };
      }

      observe(target: Element): void {
        observedPdfTargets.push(target);
        const pageNumber = Number(target.getAttribute("data-pdf-page-shell"));
        const isIntersecting = pdfVisiblePageNumbers.has(pageNumber);
        this.emit([{ isIntersecting, target }]);
      }

      disconnect() {}
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      emit(entries: ReadonlyArray<{
        readonly isIntersecting: boolean;
        readonly target: Element;
      }>): void {
        this.callback(
          entries.map((entry) => entry as IntersectionObserverEntry),
          this,
        );
      }
    }
    globalThis.IntersectionObserver = MockIntersectionObserver;
  });

  afterEach(() => {
    cleanup();
    sourceOriginalPreviewRequest.clearCacheForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders PDF pages lazily within a bounded preview window", async () => {
    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Page 35 of 35")).toBeTruthy();
    });

    expect(screen.queryByText(/Showing first 20/)).toBeNull();
    await waitFor(() => {
      expect(new Set(pdfPageRenderLog)).toEqual(
        new Set(Array.from({ length: 22 }, (_, index) => index + 1)),
      );
    });
    expect(pdfPageRenderLog.every((pageNumber) => pageNumber <= 22)).toBe(true);
    expect(screen.queryByTestId("pdf-page-35")).toBeNull();
  });

  it("unmounts PDF page canvases after pages leave the viewport window", async () => {
    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-1")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("Page 35 of 35")).toBeTruthy();
    });
    const pageOneShell = observedPdfTargets.findLast(
      (target) => target.getAttribute("data-pdf-page-shell") === "1",
    );
    const pageFifteenShell = observedPdfTargets.findLast(
      (target) => target.getAttribute("data-pdf-page-shell") === "15",
    );
    if (!latestObserver || !pageOneShell || !pageFifteenShell) {
      throw new Error("PDF page observer was not registered.");
    }

    act(() => {
      pdfVisiblePageNumbers = new Set([15]);
      latestObserver?.emit([
        { isIntersecting: false, target: pageOneShell },
        { isIntersecting: true, target: pageFifteenShell },
      ]);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("pdf-page-1")).toBeNull();
    });
  });

  it("uses loaded PDF page height instead of portrait placeholder height", async () => {
    pdfVisiblePageNumbers = new Set([1]);
    pdfPageHeight = 360;

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "landscape-report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/landscape-report.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-1")).toBeTruthy();
    });

    const pageOneShell = document.querySelector(
      '[data-pdf-page-shell="1"]',
    ) as HTMLElement | null;

    await waitFor(() => {
      expect(pageOneShell?.style.minHeight).toBe("360px");
    });
  });

  it("sizes PDF pages from the available preview width before resize callbacks", async () => {
    pdfContainerClientWidth = 1000;
    pdfVisiblePageNumbers = new Set([1]);

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "wide-report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/wide-report.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-1")).toBeTruthy();
    });

    await waitFor(() => {
      expect(pdfPageWidthLog).toContain(968);
    });
    expect(pdfPageDevicePixelRatioLog).toContain(1);
  });

  it("caps PDF canvas pixel density for high-density displays", async () => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 3,
    });
    pdfVisiblePageNumbers = new Set([1]);

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "dense-report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/dense-report.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-1")).toBeTruthy();
    });

    expect(pdfPageDevicePixelRatioLog).toContain(1.5);
  });

  it("uses more of wide preview panels instead of capping PDF pages at 1100px", async () => {
    pdfContainerClientWidth = 1800;
    pdfVisiblePageNumbers = new Set([1]);

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "wide-table-report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/wide-table-report.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-1")).toBeTruthy();
    });

    await waitFor(() => {
      expect(pdfPageWidthLog).toContain(1600);
    });
    expect(pdfPageWidthLog).not.toContain(1100);
  });

  it("shrinks PDF pages to narrow preview panels without a fixed minimum width", async () => {
    pdfContainerClientWidth = 240;
    pdfVisiblePageNumbers = new Set([1]);

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "narrow-report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/narrow-report.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-1")).toBeTruthy();
    });

    await waitFor(() => {
      expect(pdfPageWidthLog).toContain(208);
    });
    expect(pdfPageWidthLog).not.toContain(280);
  });

  it("uses PDF page dimensions for offscreen placeholders before rendering", async () => {
    pdfDocumentPageCount = 25;
    pdfVisiblePageNumbers = new Set([1]);
    pdfPageViewportWidth = 640;
    pdfPageViewportHeight = 360;

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "landscape-report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/landscape-report.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      const firstLazyPlaceholder = document.querySelector(
        '[data-pdf-page-shell="23"] .bg-background\\/80',
      ) as HTMLElement | null;

      expect(firstLazyPlaceholder?.style.height).toBe("360px");
    });
  });

  it("preserves measured placeholder height while visible PDF pages are loading", async () => {
    pdfVisiblePageNumbers = new Set([1]);
    shouldDelayPdfPageLoadSuccess = true;

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "landscape-report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/landscape-report.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-1")).toBeTruthy();
    });

    const pageOneShell = document.querySelector(
      '[data-pdf-page-shell="1"]',
    ) as HTMLElement | null;

    expect(pageOneShell?.style.minHeight).toBe("360px");
  });

  it("observes one-page PDFs whose page shells mount after document load", async () => {
    pdfDocumentPageCount = 1;
    shouldDelayPdfChildrenUntilLoad = true;

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "one-page-report.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/one-page-report.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-1")).toBeTruthy();
    });
  });

  it("leaves shared text preview downloads uncancelled when the preview unmounts", async () => {
    const fetchSignals: Array<AbortSignal | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        fetchSignals.push(init?.signal ?? undefined);
        return new Promise<Response>(() => undefined);
      }),
    );

    const { unmount } = render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "notes.txt",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/notes.txt",
          mimeType: "text/plain",
        },
      }),
    );

    await waitFor(() => {
      expect(fetchSignals).toHaveLength(1);
    });

    unmount();

    expect(fetchSignals[0]).toBeUndefined();
  });

  it("falls back to download-only for large text previews", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "large-notes.txt",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/large-notes.txt",
          mimeType: "text/plain",
          sizeBytes: 2 * 1024 * 1024,
        },
      }),
    );

    expect(screen.getByText("Preview is not available for this file.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders Markdown tables and line breaks from generated preview files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            "Service | Key Family<br>--- | ---<br>OpenAI | API key",
            { status: 200 },
          ),
        ),
      ),
    );

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "secret-fingerprint-report.md",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/secret-fingerprint-report.md",
          mimeType: "text/markdown",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeTruthy();
    });
    expect(screen.getByRole("table").closest(".original-markdown-preview")).toBeTruthy();
    expect(screen.queryByText(/<br>/)).toBeNull();
  });

  it("keeps Markdown content readable inside the responsive original preview shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("# Scan report\n\nThe scan found placeholder keys.", {
            status: 200,
          }),
        ),
      ),
    );

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "scan-report.md",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/scan-report.md",
          mimeType: "text/markdown",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Scan report")).toBeTruthy();
    });

    const previewShell = screen.getByTestId("source-original-preview");
    expect(previewShell.className).toContain("w-[90%]");
    expect(previewShell.className).toContain("max-w-[1600px]");

    const markdownPreview = document.querySelector(".original-markdown-preview");
    expect(markdownPreview?.parentElement?.className).toContain("max-w-4xl");
  });

  it("hides the download action for non-downloadable demo originals", () => {
    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "demo.pdf",
        file: {
          url: "/api/demo-sources/example/original",
          mimeType: "application/pdf",
          canDownload: false,
        },
      }),
    );

    expect(
      screen.queryByRole("link", { name: "Download original file" }),
    ).toBeNull();
  });

  it("renders public demo PDFs with the browser PDF viewer instead of fetching bytes", () => {
    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "demo.pdf",
        file: {
          url: "https://example.com/demo.pdf",
          mimeType: "application/pdf",
          canDownload: false,
          pdfPreviewMode: "browser",
        },
        targetPageNumber: 3,
        targetPageRequestId: 1,
      }),
    );

    const iframe = screen.getByTitle("demo.pdf original PDF");
    expect(iframe.getAttribute("src")).toBe("https://example.com/demo.pdf#page=3");
    expect(screen.queryByTestId("pdf-document")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the download action for uploaded originals by default", () => {
    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "upload.pdf",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    expect(
      screen.getByRole("link", { name: "Download original file" }),
    ).toBeTruthy();
  });

  it("leaves shared DOCX preview downloads uncancelled when the preview unmounts", async () => {
    const fetchSignals: Array<AbortSignal | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        fetchSignals.push(init?.signal ?? undefined);
        return new Promise<Response>(() => undefined);
      }),
    );

    const { unmount } = render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "report.docx",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/report.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      }),
    );

    await waitFor(() => {
      expect(fetchSignals).toHaveLength(1);
    });

    unmount();

    expect(fetchSignals[0]).toBeUndefined();
  });

  it("renders DOCX previews without the library fixed page width", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
        ),
      ),
    );

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "report.docx",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/report.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      }),
    );

    await waitFor(() => {
      expect(docxRenderOptionsLog).toHaveLength(1);
    });

    expect(docxRenderOptionsLog[0]).toMatchObject({ ignoreWidth: true });
  });

  it("falls back to sanitized DOCX HTML conversion when docx-preview cannot render", async () => {
    shouldRejectDocxPreviewRender = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
        ),
      ),
    );

    render(
      React.createElement(SourceOriginalPreview, {
        sourceTitle: "report.docx",
        file: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/report.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Fallback DOCX" })).toBeTruthy();
    });

    expect(mammothConvertLog).toHaveLength(1);
    expect(document.querySelector("script")).toBeNull();
    expect(
      screen.queryByText("Preview is not available for this file."),
    ).toBeNull();
  });
});
