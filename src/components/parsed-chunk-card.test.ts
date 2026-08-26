// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ParsedChunkCard } from "./parsed-chunk-card";

describe("ParsedChunkCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders text chunks with source, summary, content, and keywords", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "text_1",
          type: "text",
          content: "Tesla is adding Supercharging and AI training capacity.",
          sourceTitle: "TSLA-Q4-2025-UPDATE.PDF",
          sectionPath: "Default_Root/TSLA-Q4-2025-UPDATE.PDF-->Capacity",
          summary: "Tesla continues to add capacity.",
          keywords: ["Supercharging", "AI training capacity"],
        },
        isFocused: true,
        onReferenceClick: vi.fn(),
      }),
    );

    expect(screen.getByTestId("chunk-source-panel-text_1").textContent).toContain(
      "Capacity",
    );
    expect(
      screen.getByTestId("chunk-summary-panel-text_1").textContent,
    ).toContain("Tesla continues to add capacity.");
    expect(screen.getByTestId("chunk-content-panel-text_1").textContent).toContain(
      "Tesla is adding Supercharging and AI training capacity.",
    );
    expect(screen.getByTestId("chunk-keywords-panel-text_1").textContent).toContain(
      "AI training capacity",
    );
    expect(screen.getByTestId("chunk-card-shell-text_1").className).toContain(
      "min-w-0",
    );
  });

  it("renders page chunks as page summaries with page citations", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "page_1",
          type: "page",
          content: "The refund policy is summarized across these pages.",
          contentSource: "summary",
          readableContent: "The refund policy is summarized across these pages.",
          sourceTitle: "manual.pdf",
          sectionPath: "Default_Root/manual.pdf-->pages/4-6",
          pageNums: [4, 5, 6],
          entities: [{ text: "refund", type: "topic" }],
        },
        isFocused: false,
        isOriginalPreviewAvailable: true,
        onChunkClick: vi.fn(),
        onReferenceClick: vi.fn(),
      }),
    );

    expect(screen.getByTestId("chunk-source-panel-page_1").textContent).toContain(
      "Pages 4-6",
    );
    expect(screen.getByTestId("chunk-source-panel-page_1").textContent).toContain(
      "Root",
    );
    expect(screen.getByTestId("chunk-source-panel-page_1").textContent).toContain(
      "pages/4-6",
    );
    expect(screen.getByTestId("chunk-content-panel-page_1").textContent).toContain(
      "The refund policy is summarized",
    );
    expect(screen.getByTestId("chunk-entities-panel-page_1").textContent).toContain(
      "refund",
    );
    expect(screen.queryByTestId("chunk-summary-panel-page_1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open page 4 in original file" }),
    ).toBeTruthy();
  });

  it("renders extracted entities as tags and hides duplicate keyword rows", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "page_2",
          type: "page",
          content: "Safe harbor statement",
          sourceTitle: "Micron Q1-26 Earnings Deck_R.pdf",
          sectionPath:
            "Default_Root/Micron Q1-26 Earnings Deck_R.pdf-->Safe harbor statement",
          pageNums: [2],
          keywords: [
            "Securities and Exchange Commission",
            "Form 10-K",
            "Forms ID-9",
          ],
          entities: [
            { text: "Securities and Exchange Commission", type: "organization" },
            { text: "Form 10-K", type: "document" },
            { text: "Forms ID-9", type: "document" },
          ],
          pageAssets: [
            {
              pageNumber: 2,
              assetUrl: "https://assets.example/page-2.png",
              contentType: "image/png",
            },
          ],
        },
        isFocused: false,
        onReferenceClick: vi.fn(),
      }),
    );

    const sourcePanel = screen.getByTestId("chunk-source-panel-page_2");
    expect(sourcePanel.textContent).toContain("Page 2");
    expect(sourcePanel.textContent).toContain("Root");
    expect(sourcePanel.textContent).toContain("Safe harbor statement");
    expect(sourcePanel.textContent).not.toContain("PAGE");
    expect(screen.getByRole("img", { name: "Page 2" })).toBeTruthy();
    expect(screen.getByTestId("chunk-entities-panel-page_2").textContent).toContain(
      "Securities and Exchange Commission",
    );
    expect(screen.getByText("Form 10-K")).toBeTruthy();
    expect(screen.getByText("Forms ID-9")).toBeTruthy();
    expect(screen.queryByTestId("chunk-keywords-panel-page_2")).toBeNull();
  });

  it("renders page citation assets instead of page summary content", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "page_4",
          type: "page",
          content: "The summary should not be primary when an image exists.",
          readableContent: "The summary should not be primary when an image exists.",
          sourceTitle: "manual.pdf",
          pageNums: [4],
          pageAssets: [
            {
              pageNumber: 4,
              assetUrl: "https://assets.example/page-4.png",
              contentType: "image/png",
              width: 1200,
              height: 1600,
            },
          ],
        },
        isFocused: false,
        isOriginalPreviewAvailable: true,
        onChunkClick: vi.fn(),
        onReferenceClick: vi.fn(),
      }),
    );

    const pageImage = screen.getByRole("img", { name: "Page 4" });

    expect(pageImage.getAttribute("src")).toBe(
      "https://assets.example/page-4.png",
    );
    expect(screen.getByText("image/png")).toBeTruthy();
    expect(screen.queryByText(/summary should not be primary/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /original file/i }),
    ).toBeNull();

    fireEvent.error(pageImage);
    expect(screen.getByTestId("page-asset-image-unavailable-4")).toBeTruthy();
  });

  it("keeps the page image as a positioned citation target for a focused citation", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "page_4",
          type: "page",
          content: "Page 4",
          sourceTitle: "manual.pdf",
          pageNums: [4],
          pageAssets: [
            {
              pageNumber: 4,
              assetUrl: "https://assets.example/page-4.png",
              contentType: "image/png",
            },
          ],
        },
        isFocused: true,
        focusedCitationId: "assistant_1:0",
        focusedPageNumber: 4,
        onReferenceClick: vi.fn(),
      }),
    );

    const citationTarget = document.querySelector(
      '[data-citation-page="4"]',
    );
    expect(citationTarget).not.toBeNull();
    expect(screen.getByTestId("citation-image-stage").className).toContain(
      "relative",
    );
    expect(citationTarget?.getAttribute("data-focused-citation-id")).toBe(
      "assistant_1:0",
    );
  });

  it("draws a temporary region highlight on the focused page image", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "page_4",
          type: "page",
          content: "Page 4",
          sourceTitle: "manual.pdf",
          pageNums: [4],
          pageAssets: [
            {
              pageNumber: 4,
              assetUrl: "https://assets.example/page-4.png",
              contentType: "image/png",
            },
          ],
        },
        isFocused: true,
        focusedCitationId: "assistant_1:0",
        focusedPageNumber: 4,
        focusedPageRequestId: 2,
        highlightRegions: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.15 }],
        onReferenceClick: vi.fn(),
      }),
    );

    const pageImage = screen.getByRole("img", { name: "Page 4" });
    expect(screen.queryByTestId("citation-region-highlight")).toBeNull();

    fireEvent.load(pageImage);

    const highlight = screen.getByTestId("citation-region-highlight");
    expect(highlight.className).toContain("citation-region-flash");
    expect(highlight.getAttribute("style")).toContain("10%");
    expect(highlight.getAttribute("style")).toContain("20%");
    expect(highlight.getAttribute("style")).toContain("30%");
    expect(highlight.getAttribute("style")).toContain("15%");
    expect(
      screen.getByTestId("citation-region-highlights").parentElement,
    ).toBe(screen.getByTestId("citation-image-stage"));

    fireEvent.error(pageImage);
    expect(screen.queryByTestId("citation-region-highlight")).toBeNull();
  });

  it("hides the keywords row when a page card has none", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "page_4",
          type: "page",
          content: "Page 4",
          sourceTitle: "manual.pdf",
          pageNums: [4],
          keywords: [],
          pageAssets: [
            {
              pageNumber: 4,
              assetUrl: "https://assets.example/page-4.png",
              contentType: "image/png",
            },
          ],
        },
        isFocused: false,
        onReferenceClick: vi.fn(),
      }),
    );

    expect(screen.queryByTestId("chunk-keywords-panel-page_4")).toBeNull();
    expect(screen.getByRole("img", { name: "Page 4" })).toBeTruthy();
  });

  it("routes Notebook Blob page assets through the inline image endpoint", () => {
    const assetUrl =
      "https://store.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_1/rev_1/page_citation_assets/page-4.png";

    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "page_4",
          type: "page",
          content: "The summary should not be primary when an image exists.",
          readableContent: "The summary should not be primary when an image exists.",
          sourceTitle: "manual.pdf",
          pageNums: [4],
          pageAssets: [
            {
              pageNumber: 4,
              assetUrl,
              contentType: "image/png",
            },
          ],
        },
        isFocused: false,
        onReferenceClick: vi.fn(),
      }),
    );

    const pageImage = screen.getByRole("img", { name: "Page 4" });
    expect(pageImage.getAttribute("src")).toBe(
      `/api/parsed-assets/inline?url=${encodeURIComponent(assetUrl)}`,
    );
  });

  it("routes Notebook Blob image chunks through the inline image endpoint", () => {
    const assetUrl =
      "https://store.public.blob.vercel-storage.com/workspaces/workspace_1/sources/source_1/parsed-result/images/image-1.jpg";

    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "image_1",
          type: "image",
          content: "",
          sourceTitle: "manual.pdf",
          assetUrl,
          summary: "A scanned diagram",
        },
        isFocused: false,
        onReferenceClick: vi.fn(),
      }),
    );

    const image = screen.getByRole("img", { name: "A scanned diagram" });
    expect(image.getAttribute("src")).toBe(
      `/api/parsed-assets/inline?url=${encodeURIComponent(assetUrl)}`,
    );
  });

  it("routes resolved artifact reference clicks to the target chunk", async () => {
    const user = userEvent.setup();
    const onReferenceClick = vi.fn();

    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "text_1",
          type: "text",
          content: "See [images/image-1.jpg] for details.",
          sourceTitle: "manual.pdf",
          connections: [
            {
              targetParserChunkId: "parser_image_1",
              targetChunkId: "image_1",
              relation: "embeds",
              ref: "[images/image-1.jpg]",
              position: { start: 4, end: 24 },
            },
          ],
        },
        isFocused: false,
        onReferenceClick,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Image 1" }));
    expect(onReferenceClick).toHaveBeenCalledWith("image_1");
  });

  it("shows an explicit original preview button when chunk preview is available", async () => {
    const user = userEvent.setup();
    const chunk = {
      chunkId: "text_1",
      type: "text" as const,
      content: "Revenue details live on the second page.",
      sourceTitle: "report.pdf",
      pageNums: [2],
    };
    const onChunkClick = vi.fn();

    render(
      React.createElement(ParsedChunkCard, {
        chunk,
        isFocused: false,
        isOriginalPreviewAvailable: true,
        onChunkClick,
        onReferenceClick: vi.fn(),
      }),
    );

    const openOriginalButton = screen.getByRole("button", {
      name: "Open page 2 in original file",
    });

    expect(openOriginalButton.className).toContain("font-semibold");
    expect(openOriginalButton.className).toContain("text-primary");

    await user.click(openOriginalButton);
    expect(onChunkClick).toHaveBeenCalledWith(chunk);
    expect(screen.getByTestId("chunk-card-shell-text_1").getAttribute("role")).toBeNull();
  });

  it("hides the original file button when a chunk has no page numbers", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "text_1",
          type: "text",
          content: "Revenue details do not include page metadata.",
          sourceTitle: "report.pdf",
        },
        isFocused: false,
        isOriginalPreviewAvailable: true,
        onChunkClick: vi.fn(),
        onReferenceClick: vi.fn(),
      }),
    );

    expect(
      screen.queryByRole("button", { name: /original file/i }),
    ).toBeNull();
  });

  it("keeps original file buttons quiet when preview is not supported", async () => {
    const user = userEvent.setup();
    const chunk = {
      chunkId: "text_1",
      type: "text" as const,
      content: "Legacy report details.",
      sourceTitle: "report.doc",
      pageNums: [2],
    };
    const onChunkClick = vi.fn();

    render(
      React.createElement(ParsedChunkCard, {
        chunk,
        isFocused: false,
        isOriginalPreviewAvailable: false,
        onChunkClick,
        onReferenceClick: vi.fn(),
      }),
    );

    const openOriginalButton = screen.getByRole("button", {
      name: "Open original file",
    });

    expect(openOriginalButton.className).toContain("font-normal");
    expect(openOriginalButton.className).not.toContain("font-semibold");

    await user.click(openOriginalButton);
    expect(onChunkClick).toHaveBeenCalledWith(chunk);
  });

  it("sanitizes table HTML before rendering", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "table_1",
          type: "table",
          content:
            '<table><tbody><tr><td onclick="alert(1)">Value</td></tr></tbody></table><script>alert(1)</script>',
          sourceTitle: "report.pdf",
        },
        isFocused: false,
        onReferenceClick: vi.fn(),
      }),
    );

    const table = screen.getByTestId("chunk-table-content-table_1");

    expect(table.innerHTML).toContain("Value");
    expect(table.innerHTML).not.toContain("script");
    expect(table.innerHTML).not.toContain("onclick");
  });

  it("renders the original image file when an image chunk has no asset URL", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "image_1",
          type: "image",
          content: "Logo summary",
          summary: "A black and white logo.",
          sourceTitle: "logo.png",
        },
        isFocused: false,
        onReferenceClick: vi.fn(),
        sourceOriginalFile: {
          url: "https://blob.example/source-uploads/logo.png",
          mimeType: "image/png",
        },
      }),
    );

    const image = screen.getByRole("img", {
      name: "A black and white logo.",
    });

    expect(image.getAttribute("src")).toBe(
      "https://blob.example/source-uploads/logo.png",
    );
    expect(screen.queryByText("Image content is not available in this view.")).toBeNull();
  });
});
