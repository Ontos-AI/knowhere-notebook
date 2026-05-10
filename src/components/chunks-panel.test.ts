// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("keeps long chunk title layout while using less-rounded corners", () => {
    mockVisibleVirtualViewport();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "image_1",
            type: "image",
            content: "",
            sourceTitle: "TSLA-Q4-2025-UPDATE.PDF",
            summary:
              "IMAGE-2 THE IMAGE IS A LINE GRAPH SHOWING THE GROWTH OF FSD MILES OVER TIME",
          },
        ],
        selectedSource: "TSLA-Q4-2025-Update.pdf",
      }),
    );

    const titleBadge = screen.getByText(/TSLA-Q4-2025-UPDATE\.PDF/);

    expect(titleBadge.className).toContain("max-w-full");
    expect(titleBadge.className).toContain("whitespace-normal");
    expect(titleBadge.className).toContain("rounded-lg");
    expect(titleBadge.className).not.toContain("inline-block");
    expect(titleBadge.className).not.toContain("max-w-[calc");
    expect(titleBadge.className).not.toContain("rounded-full");
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

  it("renders image chunks and scrolls to resolved connection targets", async () => {
    mockVisibleVirtualViewport();

    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

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
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });
    expect(
      screen
        .getByRole("button", { name: "Missing" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("renders and scrolls to a focused virtual chunk outside the initial range", async () => {
    mockVisibleVirtualViewport();

    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
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
      expect(scrollIntoView).toHaveBeenCalled();
    });
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
  vi.spyOn(window.HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function getOffsetHeight(this: HTMLElement): number {
      if (this.hasAttribute("data-radix-scroll-area-viewport")) return 720;
      if (this.hasAttribute("data-index")) return 220;
      return 1;
    });
  vi.spyOn(window.HTMLElement.prototype, "offsetWidth", "get")
    .mockImplementation((): number => 720);
}
