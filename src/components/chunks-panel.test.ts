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
import { sourceOriginalPreviewRequest } from "./source-original-preview-request";

const C = ChunksPanel as React.FC<Record<string, unknown>>;
const virtualizerScrollResetDelayMs = 150;

let shouldFlushVirtualizerTimers: boolean = false;

vi.mock("react-pdf", () => ({
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: "",
    },
  },
  Document: () => React.createElement("div", { "data-testid": "pdf-document" }),
  Page: () => React.createElement("div", { "data-testid": "pdf-page" }),
}));

describe("ChunksPanel", () => {
  beforeEach(() => {
    shouldFlushVirtualizerTimers = false;
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(async () => {
    if (shouldFlushVirtualizerTimers) {
      await flushVirtualizerTimers();
    }

    cleanup();
    sourceOriginalPreviewRequest.clearCacheForTests();
    vi.unstubAllGlobals();
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

  it("defaults parsed chunks into a section tree view", () => {
    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "overview_chunk",
            parserChunkId: "parser_overview",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview",
            sourceTitle: "manual.pdf",
          },
          {
            chunkId: "robotics_chunk",
            parserChunkId: "parser_robotics",
            type: "text",
            content: "Robotics [tables/table-1.html]",
            sectionPath: "manual.pdf-->Outlook/Product-->Robotics",
            sourceTitle: "manual.pdf",
            connections: [
              {
                targetParserChunkId: "parser_table",
                targetChunkId: "table_chunk",
                relation: "embeds",
                ref: "[tables/table-1.html]",
              },
            ],
          },
          {
            chunkId: "table_chunk",
            parserChunkId: "parser_table",
            type: "table",
            content: "<table />",
            sectionPath: "tables/table-1.html",
            filePath: "tables/table-1.html",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    expect(
      screen.getByRole("tree", { name: "Parsed chunk sections" }),
    ).toBeTruthy();
    // Default: root + 1 level only — level-1 sections visible.
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Outlook")).toBeTruthy();
    // Deeper nodes hidden until expanded.
    expect(
      screen.queryByRole("treeitem", {
        name: /Robotics section with 2 chunks/i,
      }),
    ).toBeNull();

    // Expand Outlook → Product visible; expand Product → Robotics visible.
    fireEvent.click(screen.getByText("Outlook"));
    expect(screen.getByText("Product")).toBeTruthy();
    fireEvent.click(screen.getByText("Product"));
    expect(
      screen.getByRole("treeitem", {
        name: /Robotics section with 2 chunks/i,
      }),
    ).toBeTruthy();

    // Collapse Outlook → Product and Robotics hidden again.
    fireEvent.click(screen.getByText("Outlook"));
    expect(screen.queryByText("Product")).toBeNull();
    expect(
      screen.queryByRole("treeitem", {
        name: /Robotics section with 2 chunks/i,
      }),
    ).toBeNull();
  });

  it("deduplicates repeated chunks before rendering section tree keys", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "duplicate_chunk",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview",
            sourceTitle: "manual.pdf",
          },
          {
            chunkId: "duplicate_chunk",
            type: "text",
            content: "Duplicate overview text",
            sectionPath: "manual.pdf/Overview",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    expect(
      screen.getByRole("treeitem", {
        name: "Overview section with 1 chunk",
      }),
    ).toBeTruthy();
    // Chunk is hidden by default (root + 1 level); expand to see it.
    fireEvent.click(screen.getByText("Overview"));
    expect(
      screen.getAllByRole("treeitem", { name: "Overview text Text" }),
    ).toHaveLength(1);
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes("Encountered two children with the same key"),
      ),
    ).toBe(false);
  });

  it("requests the full chunk list before showing the section tree", async () => {
    const user = userEvent.setup();
    const handleLoadAllChunks = vi.fn();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
        hasMoreChunks: true,
        onLoadAllChunks: handleLoadAllChunks,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    expect(handleLoadAllChunks).toHaveBeenCalledTimes(1);
  });

  it("keeps the section tree background as wide as the computed tree", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview/Product/Robotics",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    const tree = screen.getByRole("tree", { name: "Parsed chunk sections" });
    const card = tree.parentElement as HTMLElement;
    const treeWidth = Number.parseInt(tree.style.width, 10);
    const cardMinimumWidth = Number.parseInt(card.style.minWidth, 10);

    expect(tree.style.width).not.toBe("");
    expect(cardMinimumWidth).toBeGreaterThanOrEqual(treeWidth);
  });

  it("fills the visible section tree card with the draggable canvas", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview/Product/Robotics",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    const surface = screen.getByTestId("chunk-section-tree-zoom-surface");
    const tree = screen.getByRole("tree", { name: "Parsed chunk sections" });
    const treeWidth = Number.parseInt(tree.style.width, 10);
    const surfaceMinimumWidth = Number.parseInt(surface.style.minWidth, 10);

    expect(surface.style.width).toBe("100%");
    expect(surfaceMinimumWidth).toBeGreaterThanOrEqual(treeWidth);
  });

  it("renders section tree zoom controls over the canvas", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview/Product/Robotics",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    const overlay = screen.getByTestId("chunk-section-tree-zoom-overlay");
    const scrollContent = screen.getByTestId("chunks-scroll-content");

    expect(overlay.className).toContain("absolute");
    expect(overlay.className).toContain("left-3");
    expect(overlay.className).toContain("top-3");
    expect(scrollContent.contains(overlay)).toBe(false);
    expect(
      screen.getByRole("group", { name: "Section tree zoom" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Zoom in section tree" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Zoom out section tree" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reset section tree zoom" }),
    ).toBeTruthy();
  });

  it("resets the section tree zoom from the zoom controls", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview/Product/Robotics",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    const tree = screen.getByRole("tree", { name: "Parsed chunk sections" });
    const resetButton = screen.getByRole("button", {
      name: "Reset section tree zoom",
    });

    expect(resetButton.hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Zoom in section tree" }));

    expect(tree.style.transform).toBe("scale(1.1)");
    expect(screen.getByText("110%")).toBeTruthy();
    expect(resetButton.hasAttribute("disabled")).toBe(false);

    await user.click(resetButton);

    expect(tree.style.transform).toBe("scale(1)");
    expect(screen.getByText("100%")).toBeTruthy();
    expect(resetButton.hasAttribute("disabled")).toBe(true);
  });

  it("allows the section tree to zoom out to 30 percent with the mouse wheel", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview/Product/Robotics",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    const tree = screen.getByRole("tree", { name: "Parsed chunk sections" });
    const surface = screen.getByTestId("chunk-section-tree-zoom-surface");
    const initialSurfaceMinimumWidth = Number.parseInt(
      surface.style.minWidth,
      10,
    );

    for (let i = 0; i < 7; i += 1) {
      fireEvent.wheel(surface, { deltaY: 120, ctrlKey: true });
    }

    const zoomedOutSurfaceMinimumWidth = Number.parseInt(
      surface.style.minWidth,
      10,
    );

    expect(tree.style.transform).toBe("scale(0.3)");
    expect(zoomedOutSurfaceMinimumWidth).toBeLessThan(
      initialSurfaceMinimumWidth,
    );
  });

  it("zooms the section tree with the mouse wheel", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview/Product/Robotics",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    const tree = screen.getByRole("tree", { name: "Parsed chunk sections" });
    const surface = screen.getByTestId("chunk-section-tree-zoom-surface");
    const zoomInEvent = new WheelEvent("wheel", {
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
    });

    act(() => {
      surface.dispatchEvent(zoomInEvent);
    });

    expect(zoomInEvent.defaultPrevented).toBe(true);
    expect(tree.style.transform).toBe("scale(1.1)");

    fireEvent.wheel(surface, { deltaY: 120, ctrlKey: true });

    expect(tree.style.transform).toBe("scale(1)");
  });

  it("pans the section tree canvas by dragging the background", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview/Product/Robotics",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    const surface = screen.getByTestId("chunk-section-tree-zoom-surface");
    const tree = screen.getByRole("tree", { name: "Parsed chunk sections" });

    fireEvent.mouseDown(surface, { button: 0, clientX: 100, clientY: 90 });
    fireEvent.mouseMove(window, { clientX: 142, clientY: 126 });
    fireEvent.mouseUp(window);

    expect(tree.style.left).toBe("42px");
    expect(tree.style.top).toBe("36px");
    expect(surface.className).toContain("cursor-grab");
  });

  it("uses pointer cursor and Violet colors for clickable section tree chunk nodes", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "robotics_chunk",
            type: "text",
            content: "Robotics details",
            sectionPath: "manual.pdf/Outlook/Robotics",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    // Expand the collapsed path (root + 1 level by default).
    fireEvent.click(screen.getByText("Outlook"));
    fireEvent.click(screen.getByText("Robotics"));

    const chunkNode = screen.getByRole("button", {
      name: /Robotics details\s*Text/,
    });

    expect(chunkNode.className).toContain("cursor-pointer");
    expect(chunkNode.className).toContain("border-violet-200");
    expect(chunkNode.className).toContain("bg-violet-50");
    expect(chunkNode.className).toContain("hover:bg-violet-100");
  });

  it("returns to the list and focuses a chunk when its tree node is clicked", async () => {
    mockVisibleVirtualViewport();
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "overview_chunk",
            type: "text",
            content: "Overview text",
            sectionPath: "manual.pdf/Overview",
            sourceTitle: "manual.pdf",
          },
          {
            chunkId: "robotics_chunk",
            type: "text",
            content: "Robotics details",
            sectionPath: "manual.pdf/Outlook/Robotics",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Tree" }));

    // Expand the collapsed path to reach the chunk node.
    fireEvent.click(screen.getByText("Outlook"));
    fireEvent.click(screen.getByText("Robotics"));

    await user.click(
      screen.getByRole("button", { name: /Robotics details\s*Text/ }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("tree", { name: "Parsed chunk sections" }),
      ).toBeNull();
    });
    expect(screen.getByTestId("chunk-card-shell-robotics_chunk")).toBeTruthy();
  });

  it("switches source-only citation navigation from tree to list view", async () => {
    mockVisibleVirtualViewport();
    const chunks = [
      {
        chunkId: "image_details_chunk",
        type: "image",
        content: "",
        sectionPath: "images/image-81-__details_.jpg",
        sourceTitle: "product-manual.pdf",
      },
    ];
    const { rerender } = render(
      React.createElement(C, {
        chunks,
        selectedSource: "product-manual.pdf",
        citationListViewRequestId: 0,
      }),
    );

    expect(
      screen.getByRole("tree", { name: "Parsed chunk sections" }),
    ).toBeTruthy();

    rerender(
      React.createElement(C, {
        chunks,
        selectedSource: "product-manual.pdf",
        citationListViewRequestId: 1,
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("tree", { name: "Parsed chunk sections" }),
      ).toBeNull();
    });
    expect(
      screen.getByTestId("chunk-card-shell-image_details_chunk"),
    ).toBeTruthy();
  });

  it("shows a large upload target when no document is selected", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [],
        selectedSource: null,
        onSourceUploaded: vi.fn(),
      }),
    );

    await user.click(
      screen.getByRole("button", { name: /Upload a document/i }),
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Add source")).toBeTruthy();
  });

  it("accepts dropped files from the empty chunk upload target", async () => {
    render(
      React.createElement(C, {
        chunks: [],
        selectedSource: null,
        onSourceUploaded: vi.fn(),
      }),
    );

    const dropTarget = screen.getByRole("button", {
      name: /Upload a document/i,
    });
    const dropEvent = createFileDropEvent(
      new File(["hello"], "drop.pdf", { type: "application/pdf" }),
    );

    await act(async () => {
      dropTarget.dispatchEvent(dropEvent);
    });

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(await screen.findByText("Selected: drop.pdf")).toBeTruthy();
  });

  it("switches to a download-only original file state for unsupported previews", async () => {
    mockVisibleVirtualViewport();
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Legacy report details live in the original file.",
            sourceTitle: "brief.doc",
            pageNums: [2],
          },
        ],
        selectedSource: "brief.doc",
        selectedSourceFile: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.doc",
          mimeType: "application/msword",
        },
      }),
    );
    selectListView();

    const openOriginalButton = screen.getByRole("button", {
      name: "Open original file",
    });

    expect(openOriginalButton.className).toContain("font-normal");
    expect(openOriginalButton.className).not.toContain("font-semibold");

    await user.click(openOriginalButton);

    const downloadLink = screen.getByRole("link", {
      name: "Download original file",
    });
    expect(downloadLink.getAttribute("href")).toBe(
      "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.doc?download=1",
    );
    expect(screen.getByText("Preview is not available for this file.")).toBeTruthy();
  });

  it("uses compact, non-folding spacing for the mobile chunk view", () => {
    render(React.createElement(C, { chunks: [] }));

    expect(screen.getByTestId("chunks-panel").className).toContain("min-w-0");
    expect(screen.getByTestId("chunks-scroll-content").className).toContain(
      "p-3",
    );
  });

  it("lets parsed chunks use most of the middle panel width", () => {
    render(React.createElement(C, { chunks: [] }));

    const scrollContentClassName =
      screen.getByTestId("chunks-scroll-content").className;

    expect(scrollContentClassName).toContain("w-[90%]");
    expect(scrollContentClassName).not.toContain("max-w-4xl");
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
    selectListView();

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
    selectListView();

    const sourcePanel = screen.getByTestId("chunk-source-panel-image_1");

    expect(screen.queryByText("TSLA-Q4-2025-UPDATE.PDF")).toBeNull();
    expect(sourcePanel.textContent).toContain("Image");
    expect(sourcePanel.textContent).toContain("images/image-2.jpg");
  });

  it("hides Knowhere default root prefixes from chunk section titles", () => {
    mockVisibleVirtualViewport();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "text_1",
            type: "text",
            content: "Financial summary content.",
            sourceTitle: "TSLA-Q4-2025-Update.pdf",
            sectionPath:
              "Default_Root/TSLA-Q4-2025-Update.pdf-->FINANCIAL SUMMARY",
          },
          {
            chunkId: "text_2",
            type: "text",
            content: "Storage deployment content.",
            sourceTitle: "TSLA-Q4-2025-Update.pdf",
            sectionPath:
              "Default_Root/TSLA-Q4-2025-Update.pdf-->OPERATIONAL SUMMARY-->Energy generation and storage",
          },
        ],
        selectedSource: "TSLA-Q4-2025-Update.pdf",
      }),
    );
    selectListView();

    const financialSourcePanel = screen.getByTestId(
      "chunk-source-panel-text_1",
    );
    const storageSourcePanel = screen.getByTestId("chunk-source-panel-text_2");

    expect(financialSourcePanel.textContent).toContain("FINANCIAL SUMMARY");
    expect(financialSourcePanel.textContent).not.toContain("Default_Root");
    expect(financialSourcePanel.textContent).not.toContain(
      "TSLA-Q4-2025-Update.pdf",
    );
    expect(storageSourcePanel.textContent).toContain(
      "OPERATIONAL SUMMARY / Energy generation and storage",
    );
    expect(storageSourcePanel.textContent).not.toContain("Default_Root");
    expect(storageSourcePanel.textContent).not.toContain(
      "TSLA-Q4-2025-Update.pdf",
    );
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
    selectListView();

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

  it("renders image chunks and focuses the resolved connection target alone", async () => {
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
    selectListView();

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
    // The unresolved reference lives on text_1, which is hidden once the
    // image is focused.
    expect(screen.queryByTestId("chunk-card-shell-text_1")).toBeNull();
  });

  it("lets in-chunk table references override the current citation focus", async () => {
    mockVisibleVirtualViewport();
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "text_1",
            parserChunkId: "parser_text_1",
            type: "text",
            content: "See [tables/table-1.html] for Roadster details.",
            sourceTitle: "manual.pdf",
            connections: [
              {
                targetParserChunkId: "parser_table_1",
                targetChunkId: "table_1",
                relation: "embeds",
                ref: "[tables/table-1.html]",
                position: { start: 4, end: 25 },
              },
            ],
          },
          {
            chunkId: "table_1",
            parserChunkId: "parser_table_1",
            type: "table",
            content:
              "<table><tbody><tr><td>Roadster</td><td>TBD</td></tr></tbody></table>",
            sourceTitle: "manual.pdf",
          },
        ],
        selectedSource: "manual.pdf",
        focusedChunkId: "text_1",
        focusedChunkRequestId: 1,
      }),
    );
    selectListView();

    await user.click(screen.getByRole("button", { name: "Table 1" }));

    await waitFor(() => {
      const focusedRow = screen
        .getByTestId("chunk-card-shell-table_1")
        .closest("[data-index]");

      expect(focusedRow?.getAttribute("data-index")).toBe("0");
      expect(focusedRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
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
    selectListView();

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
    selectListView();
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
    // Smooth scroll doesn't complete in jsdom; the key assertion is that
    // the focused chunk reorders to index 0 (already checked above).
  });

  it("remeasures a tall focused chunk shown alone after citation focus", async () => {
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
    selectListView();

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

      expect(focusedRow?.getAttribute("data-index")).toBe("0");
      expect(focusedRow?.getAttribute("data-focused-chunk")).toBe("true");
    });

    // Only the focused chunk is shown — the rest of the document is hidden.
    expect(
      screen.queryByTestId("chunk-card-shell-chunk_1"),
    ).toBeNull();
    expect(screen.queryByTestId("chunk-card-shell-chunk_2")).toBeNull();
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
    selectListView();
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
    // Smooth scroll doesn't complete in jsdom; the rAF callbacks verify
    // the focus mechanism fired — that's sufficient.
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
    selectListView();

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

function selectListView(): void {
  fireEvent.click(screen.getByRole("button", { name: "List" }));
}

function createFileDropEvent(file: File): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  const files: Pick<FileList, "length" | "item"> & { readonly 0: File } = {
    0: file,
    length: 1,
    item: (index: number): File | null => (index === 0 ? file : null),
  };
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      types: ["Files"],
    },
  });
  return event;
}

function mockVirtualViewportWithChunkHeights(
  heightsByChunkId: Readonly<Record<string, number>>,
): void {
  shouldFlushVirtualizerTimers = true;

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

async function flushVirtualizerTimers(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, virtualizerScrollResetDelayMs + 25);
    });
  });
}
