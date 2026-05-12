// @vitest-environment jsdom
import React, { useEffect, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SourceOriginalPdfPreview } from "./source-original-pdf-preview";
import { sourceOriginalPreviewRequest } from "./source-original-preview-request";

const pdfPageRenderLog: number[] = [];
const pdfPageWidthLog: number[] = [];
let pdfDocumentPageCount = 2;
let pdfVisiblePageNumbers: ReadonlySet<number> = new Set([1]);
let pdfContainerClientWidth = 672;

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
    useEffect(() => {
      onLoadSuccess({
        numPages: pdfDocumentPageCount,
        getPage: () =>
          Promise.resolve({
            getViewport: ({ scale }) => ({
              width: 640 * scale,
              height: 360 * scale,
            }),
          }),
      });
    }, [onLoadSuccess]);

    return React.createElement("div", { "data-testid": "pdf-document" }, children);
  },
  Page({
    pageNumber,
    width,
  }: {
    readonly pageNumber: number;
    readonly width: number;
  }) {
    pdfPageRenderLog.push(pageNumber);
    pdfPageWidthLog.push(width);
    return React.createElement("div", {
      "data-testid": `pdf-page-${pageNumber}`,
    });
  },
}));

describe("SourceOriginalPdfPreview", () => {
  beforeEach(() => {
    pdfPageRenderLog.length = 0;
    pdfPageWidthLog.length = 0;
    pdfDocumentPageCount = 2;
    pdfVisiblePageNumbers = new Set([1]);
    pdfContainerClientWidth = 672;
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return pdfContainerClientWidth;
      },
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

      constructor(private readonly callback: IntersectionObserverCallback) {}

      observe(target: Element): void {
        const pageNumber = Number(target.getAttribute("data-pdf-page-shell"));
        this.callback(
          [
            {
              isIntersecting: pdfVisiblePageNumbers.has(pageNumber),
              target,
            } as IntersectionObserverEntry,
          ],
          this,
        );
      }

      disconnect() {}
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
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

  it("uses measured PDF page dimensions and prerenders ahead of visible pages", async () => {
    render(
      React.createElement(SourceOriginalPdfPreview, {
        file: {
          url: "https://example.com/report.pdf",
          mimeType: "application/pdf",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    });
    await waitFor(() => {
      expect(pdfPageRenderLog).toContain(1);
    });

    expect(pdfPageRenderLog).toContain(2);
    expect(pdfPageWidthLog).toContain(640);
  });
});
