// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChunksPanel } from "./chunks-panel";

const C = ChunksPanel as React.FC<Record<string, unknown>>;

describe("ChunksPanel", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uses parsed chunk language", () => {
    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "The course starts on Monday.",
            sourceTitle: "lecture.pdf",
          },
        ],
        selectedSource: "lecture.pdf",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Parsed Chunks" }),
    ).toBeTruthy();
    expect(screen.getByText(/Showing all parsed chunks from/)).toBeTruthy();
  });

  it("switches to a download-only original file state for unsupported previews", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [],
        selectedSource: "brief.doc",
        selectedSourceFile: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.doc",
          mimeType: "application/msword",
        },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Original" }));

    const downloadLink = screen.getByRole("link", {
      name: "Download original file",
    });
    expect(downloadLink.getAttribute("href")).toBe(
      "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.doc?download=1",
    );
    expect(screen.getByText("Preview is not available for this file.")).toBeTruthy();
  });

  it("renders browser-supported image originals inline", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [],
        selectedSource: "diagram.png",
        selectedSourceFile: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.png",
          mimeType: "image/png",
        },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Original" }));

    const image = screen.getByRole("img", { name: "diagram.png" });
    expect(image.getAttribute("src")).toBe(
      "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.png",
    );
  });

  it("returns to parsed chunks when a citation focuses a chunk from the original view", async () => {
    mockVisibleVirtualViewport();
    const user = userEvent.setup();
    const chunks = [
      {
        chunkId: "chunk_1",
        type: "text",
        content: "Referenced content from the parsed document.",
        sourceTitle: "report.doc",
      },
    ];
    const selectedSourceFile = {
      url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.doc",
      mimeType: "application/msword",
    };
    const { rerender } = render(
      React.createElement(C, {
        chunks,
        selectedSource: "report.doc",
        selectedSourceFile,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Original" }));
    expect(screen.getByRole("heading", { name: "Original File" })).toBeTruthy();

    rerender(
      React.createElement(C, {
        chunks,
        selectedSource: "report.doc",
        selectedSourceFile,
        focusedChunkId: "chunk_1",
        focusedChunkRequestId: 1,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Referenced Chunks" }),
      ).toBeTruthy();
    });
    expect(screen.getByTestId("chunk-card-shell-chunk_1")).toBeTruthy();
  });

  it("uses compact, non-folding spacing for the mobile chunk view", () => {
    render(React.createElement(C, { chunks: [] }));

    expect(screen.getByTestId("chunks-panel").className).toContain("min-w-0");
    expect(screen.getByTestId("chunks-scroll-content").className).toContain(
      "p-3",
    );
  });

  it("keeps demo table chunks within the responsive chunk column", () => {
    mockVisibleVirtualViewport();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "table_1",
            type: "table",
            content:
              "<table><tbody><tr><td>very-long-demo-table-cell-that-should-scroll-inside-the-card</td><td>another-wide-cell</td></tr></tbody></table>",
            sourceTitle: "demo.pdf",
          },
        ],
        selectedSource: "demo.pdf",
      }),
    );

    expect(screen.getByTestId("chunks-scroll-content").className).toContain(
      "min-w-0",
    );
    expect(screen.getByTestId("chunk-card-shell-table_1").className).toContain(
      "min-w-0",
    );
    expect(screen.getByTestId("chunk-table-content-table_1").className).toContain(
      "max-w-full",
    );
  });

  it("omits repeated source titles while keeping compact chunk metadata", () => {
    mockVisibleVirtualViewport();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "image_1",
            type: "image",
            content: "",
            sourceTitle: "TSLA-Q4-2025-UPDATE.PDF",
            sectionPath: "images/image-2.jpg",
            summary:
              "IMAGE-2 THE IMAGE IS A LINE GRAPH SHOWING THE GROWTH OF FSD MILES OVER TIME",
          },
        ],
      }),
    );

    const sourcePanel = screen.getByTestId("chunk-source-panel-image_1");

    expect(screen.queryByText("TSLA-Q4-2025-UPDATE.PDF")).toBeNull();
    expect(sourcePanel.textContent).toContain("Image");
    expect(sourcePanel.textContent).toContain("images/image-2.jpg");
  });

  it("renders text chunks with structured source, summary, content, and keyword sections", () => {
    mockVisibleVirtualViewport();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "text_1",
            type: "text",
            content: "Tesla is adding Supercharging and AI training capacity.",
            sourceTitle: "TSLA-Q4-2025-UPDATE.PDF",
            sectionPath: "Installed Annual Capacity",
            summary:
              "Tesla continues to use its North American footprint while adding capacity.",
            keywords: ["Robotaxi", "Supercharging", "AI training capacity"],
          },
        ],
        selectedSource: "TSLA-Q4-2025-UPDATE.PDF",
      }),
    );

    expect(screen.getByTestId("chunk-source-panel-text_1").textContent).toContain(
      "Installed Annual Capacity",
    );
    expect(
      screen.getByTestId("chunk-source-panel-text_1").textContent,
    ).not.toContain("TSLA-Q4-2025-UPDATE.PDF");
    expect(screen.getByTestId("chunk-summary-panel-text_1").textContent).toContain(
      "Tesla continues to use its North American footprint",
    );
    expect(screen.getByTestId("chunk-content-panel-text_1").textContent).toContain(
      "Tesla is adding Supercharging and AI training capacity.",
    );
    expect(screen.getByTestId("chunk-keywords-panel-text_1").textContent).toContain(
      "AI training capacity",
    );
    expect(
      screen.getByTestId("chunk-keywords-panel-text_1").className,
    ).toContain("bg-emerald-50/70");
    expect(screen.getByText("Robotaxi").className).toContain("bg-emerald-100/90");
    expect(screen.getByText("Robotaxi").className).toContain("text-emerald-800");
  });

  it("allows horizontal scrolling for wide chunk content", async () => {
    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "table_1",
            type: "table",
            content:
              "<table><tbody><tr><td>very-long-demo-table-cell-that-should-scroll-inside-the-card</td><td>another-wide-cell</td></tr></tbody></table>",
            sourceTitle: "demo.pdf",
          },
        ],
        selectedSource: "demo.pdf",
      }),
    );

    const viewport = screen
      .getByTestId("chunks-panel")
      .querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");

    await waitFor(() => {
      expect(viewport?.style.overflowX).toBe("scroll");
    });
  });

  it("renders image chunks and moves resolved connection targets first", async () => {
    mockVisibleVirtualViewport();

    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "text_1",
            parserChunkId: "parser_text_1",
            type: "text",
            content:
              "See [images/image-1.jpg] and [tables/missing.html] for details.",
            sourceTitle: "manual.pdf",
            connections: [
              {
                targetParserChunkId: "parser_image_1",
                targetChunkId: "image_1",
                relation: "embeds",
                ref: "[images/image-1.jpg]",
                position: { start: 4, end: 24 },
              },
              {
                targetParserChunkId: "missing_parser",
                relation: "embeds",
                ref: "[tables/missing.html]",
              },
            ],
          },
          {
            chunkId: "image_1",
            parserChunkId: "parser_image_1",
            type: "image",
            content: "",
            sourceTitle: "manual.pdf",
            summary: "A wiring diagram.",
            assetUrl: "https://blob.example/images/image-1.jpg",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    const image = screen.getByRole("img", { name: "A wiring diagram." });
    expect(image.getAttribute("src")).toBe(
      "https://blob.example/images/image-1.jpg",
    );

    await user.click(screen.getByRole("button", { name: "Image 1" }));
    await waitFor(() => {
      const focusedRow = screen
        .getByTestId("chunk-card-shell-image_1")
        .closest("[data-index]");

      expect(focusedRow?.getAttribute("data-index")).toBe("0");
      expect(focusedRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
    expect(
      screen
        .getByRole("button", { name: "Missing" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("renders a focused virtual chunk outside the initial range first", async () => {
    mockVisibleVirtualViewport();

    const chunks = Array.from({ length: 60 }, (_, index) => ({
      chunkId: `chunk_${index + 1}`,
      type: "text",
      content: `Chunk ${index + 1} content`,
      sourceTitle: "large.pdf",
    }));

    render(
      React.createElement(C, {
        chunks,
        selectedSource: "large.pdf",
        focusedChunkId: "chunk_50",
        focusedChunkRequestId: 1,
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("chunk-card-shell-chunk_50")).toBeTruthy();
    });
    await waitFor(() => {
      const focusedRow = screen
        .getByTestId("chunk-card-shell-chunk_50")
        .closest("[data-index]");

      expect(focusedRow?.getAttribute("data-index")).toBe("0");
      expect(focusedRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
  });

  it("places the focused chunk first and resets the list to the start", async () => {
    mockVisibleVirtualViewport();

    const chunks = Array.from({ length: 8 }, (_, index) => ({
      chunkId: `chunk_${index + 1}`,
      type: "text",
      content: `Chunk ${index + 1} content`,
      sourceTitle: "large.pdf",
    }));
    const { rerender } = render(
      React.createElement(C, {
        chunks,
        selectedSource: "large.pdf",
      }),
    );
    const viewport = screen
      .getByTestId("chunks-panel")
      .querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) throw new Error("Chunks viewport was not rendered.");
    viewport.scrollTop = 440;
    fireEvent.scroll(viewport);

    rerender(
      React.createElement(C, {
        chunks,
        selectedSource: "large.pdf",
        focusedChunkId: "chunk_6",
        focusedChunkRequestId: 1,
      }),
    );

    await waitFor(() => {
      const focusedRow = screen
        .getByTestId("chunk-card-shell-chunk_6")
        .closest("[data-index]");

      expect(focusedRow?.getAttribute("data-index")).toBe("0");
      expect(focusedRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
    await waitFor(() => {
      expect(viewport.scrollTop).toBe(0);
    });
  });

  it("remeasures a tall focused chunk after citation reordering", async () => {
    mockVirtualViewportWithChunkHeights({
      chunk_1: 120,
      table_3: 520,
      chunk_2: 120,
    });

    const chunks = [
      {
        chunkId: "chunk_1",
        type: "text",
        content: "Opening summary.",
        sourceTitle: "large.pdf",
      },
      {
        chunkId: "chunk_2",
        type: "text",
        content: "Second text chunk.",
        sourceTitle: "large.pdf",
      },
      {
        chunkId: "table_3",
        type: "table",
        content:
          "<table><tbody><tr><td>Tall table content</td></tr></tbody></table>",
        sourceTitle: "large.pdf",
      },
    ];
    const { rerender } = render(
      React.createElement(C, {
        chunks,
        selectedSource: "large.pdf",
      }),
    );

    rerender(
      React.createElement(C, {
        chunks,
        selectedSource: "large.pdf",
        focusedChunkId: "table_3",
        focusedChunkRequestId: 1,
      }),
    );

    await waitFor(() => {
      const focusedRow = screen
        .getByTestId("chunk-card-shell-table_3")
        .closest<HTMLElement>("[data-index]");
      const followingRow = screen
        .getByTestId("chunk-card-shell-chunk_1")
        .closest<HTMLElement>("[data-index]");

      expect(focusedRow?.getAttribute("data-index")).toBe("0");
      expect(followingRow?.getAttribute("data-index")).toBe("1");
      expect(followingRow?.style.transform).toBe("translateY(520px)");
    });
  });

  it("reapplies the start position after the focused chunk layout pass", async () => {
    const frameCallbacks: Array<FrameRequestCallback> = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mockVirtualViewportWithChunkHeights({
      chunk_1: 120,
      table_3: 520,
      chunk_2: 120,
    });

    const chunks = [
      {
        chunkId: "chunk_1",
        type: "text",
        content: "Opening summary.",
        sourceTitle: "large.pdf",
      },
      {
        chunkId: "chunk_2",
        type: "text",
        content: "Second text chunk.",
        sourceTitle: "large.pdf",
      },
      {
        chunkId: "table_3",
        type: "table",
        content:
          "<table><tbody><tr><td>Tall table content</td></tr></tbody></table>",
        sourceTitle: "large.pdf",
      },
    ];
    const { rerender } = render(
      React.createElement(C, {
        chunks,
        selectedSource: "large.pdf",
      }),
    );
    const viewport = screen
      .getByTestId("chunks-panel")
      .querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!viewport) throw new Error("Chunks viewport was not rendered.");
    viewport.scrollTop = 440;
    fireEvent.scroll(viewport);

    rerender(
      React.createElement(C, {
        chunks,
        selectedSource: "large.pdf",
        focusedChunkId: "table_3",
        focusedChunkRequestId: 1,
      }),
    );

    await waitFor(() => {
      expect(
        screen
          .getByTestId("chunk-card-shell-table_3")
          .closest("[data-index]")
          ?.getAttribute("data-index"),
      ).toBe("0");
    });
    viewport.scrollTop = 312;

    expect(frameCallbacks.length).toBeGreaterThan(0);
    act(() => {
      frameCallbacks.forEach((callback) => callback(0));
    });

    expect(viewport.scrollTop).toBe(0);
  });

  it("formats generated artifact references for display", () => {
    mockVisibleVirtualViewport();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "text_1",
            type: "text",
            content:
              "The summary references [tables/table-5 Financial Metrics 2022-26.html].",
            sourceTitle: "annual-report.pdf",
            connections: [
              {
                targetParserChunkId: "parser_table_5",
                targetChunkId: "table_5",
                relation: "embeds",
                ref: "[tables/table-5 Financial Metrics 2022-26.html]",
              },
            ],
          },
        ],
        selectedSource: "annual-report.pdf",
      }),
    );

    expect(
      screen.getByRole("button", {
        name: "Table 5 Financial Metrics 2022-26",
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/tables\/table-5/)).toBeNull();
    expect(screen.queryByText(/\.html/)).toBeNull();
  });

  it("does not load more chunks from a zero-sized hidden viewport", async () => {
    const onLoadMore = vi.fn();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Already loaded chunk.",
            sourceTitle: "large.pdf",
          },
        ],
        hasMoreChunks: true,
        onLoadMore,
      }),
    );

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not render virtual chunk rows for a zero-sized hidden viewport", async () => {
    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Hidden panel chunk.",
            sourceTitle: "large.pdf",
          },
        ],
      }),
    );

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    expect(screen.queryByTestId("chunk-card-shell-chunk_1")).toBeNull();
  });
});

function mockVisibleVirtualViewport(): void {
  mockVirtualViewportWithChunkHeights({});
}

function mockVirtualViewportWithChunkHeights(
  heightsByChunkId: Readonly<Record<string, number>>,
): void {
  vi.spyOn(window.HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function getOffsetHeight(this: HTMLElement): number {
      if (this.hasAttribute("data-radix-scroll-area-viewport")) return 720;
      const chunkId = this.getAttribute("data-chunk-id");
      if (chunkId) return heightsByChunkId[chunkId] ?? 220;
      if (this.hasAttribute("data-index")) return 220;
      return 1;
    });
  vi.spyOn(window.HTMLElement.prototype, "offsetWidth", "get")
    .mockImplementation((): number => 720);
}
