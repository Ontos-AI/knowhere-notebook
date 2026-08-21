// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatMessageList } from "./chat-message-list";

describe("ChatMessageList", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    vi.spyOn(window.HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function getOffsetHeight(this: HTMLElement): number {
        if (this.hasAttribute("data-radix-scroll-area-viewport")) return 720;
        if (this.hasAttribute("data-index")) return 160;
        return 1;
      });
    vi.spyOn(window.HTMLElement.prototype, "offsetWidth", "get")
      .mockImplementation((): number => 720);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders assistant citations using Notebook source labels", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "The deadline is Monday.",
            citations: [
              {
                chunkType: "text",
                score: 0.9,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "document-CFxAaNTRUliEnWOokpI66xfj7JJkad.pdf",
                  sectionPath: "Root",
                },
              },
            ],
          },
        ],
        sourceTitlesByDocumentId: {
          doc_1: "Syllabus.pdf",
        },
      }),
    );

    expect(
      screen.getByRole("button", { name: "Open source Syllabus.pdf" }),
    ).toBeTruthy();
  });

  it("renders citations in a bottom source area as file chips", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: [
              "Capital expenditure appears in the appendix. [[cite:1]]",
              "Drivers are discussed elsewhere. [[cite:3]]",
            ].join("\n\n"),
            citations: [
              {
                chunkType: "table",
                score: 0.9,
                pageCitationPageNumber: 25,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "spacex-s1.pdf",
                  sectionPath:
                    "Assets / tables / table-25 Capital Expenditures.html",
                },
              },
              {
                chunkType: "table",
                score: 0.91,
                pageCitationPageNumber: 25,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "spacex-s1.pdf",
                  sectionPath:
                    "Assets / tables / table-25 Capital Expenditures.html",
                },
              },
              {
                chunkType: "text",
                score: 0.8,
                pageCitationPageNumber: 40,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "spacex-s1.pdf",
                  sectionPath: "MD&A / Drivers of Our Performance",
                },
              },
            ],
          },
        ],
        onCitationClick: vi.fn(),
      }),
    );

    expect(screen.getByText(/Capital expenditure appears in the appendix./u))
      .toBeTruthy();
    expect(screen.queryByText(/Source 1/u)).toBeNull();
    expect(screen.queryByText(/\[\[cite:/u)).toBeNull();
    expect(screen.getByText("Sources")).toBeTruthy();
    const sourceChips = screen.getAllByTestId("citation-chip");

    expect(sourceChips).toHaveLength(2);
    expect(sourceChips[0]?.textContent).toBe("spacex-s1.pdf/p25");
    expect(sourceChips[1]?.textContent).toBe("spacex-s1.pdf/p40");
    expect(sourceChips[0]?.className).toContain("bg-muted");
    expect(sourceChips[0]?.className).toContain("h-5");
    expect(
      screen.getByRole("button", { name: "Open source spacex-s1.pdf" }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Open page 25 of spacex-s1.pdf" }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Open page 40 of spacex-s1.pdf" }),
    ).toBeTruthy();

    await user.hover(sourceChips[0]!);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe(
      "spacex-s1.pdf · Assets / tables / table-25 Capital Expenditures.html",
    );
  });

  it("renders a separate page image link without replacing source focus", async () => {
    const user = userEvent.setup();
    const onCitationClick = vi.fn();

    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "The referenced page discusses revenue.",
            citations: [
              {
                chunkType: "page",
                score: 0.9,
                pageCitationAssetUrl:
                  "https://blob.example/pages/page-000004.png",
                pageCitationPageNumber: 4,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "report.pdf",
                  sectionPath: "Page 4",
                },
              },
            ],
          },
        ],
        onCitationClick,
      }),
    );

    const citationButton = screen.getByRole("button", {
      name: "Open page 4 of report.pdf",
    });
    expect(
      screen.queryByRole("link", {
        name: "Open page image for report.pdf",
      }),
    ).toBeNull();

    await user.click(citationButton);
    expect(onCitationClick).toHaveBeenCalledWith(
      expect.objectContaining({
        pageCitationAssetUrl: "https://blob.example/pages/page-000004.png",
        pageCitationPageNumber: 4,
      }),
      "assistant_1:0",
    );
  });

  it("renders inline chips for leftover Source tokens without rewriting fenced code", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: [
              "Revenue improved [Source 1: revenue growth].",
              "",
              "```ts",
              "const  value = 1;",
              "```",
            ].join("\n"),
            citations: [
              {
                chunkType: "text",
                score: 0.9,
                description: "revenue growth",
                pageCitationPageNumber: 2,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "notes.pdf",
                  sectionPath: "Revenue",
                },
              },
            ],
          },
        ],
      }),
    );

    expect(screen.getByText(/Revenue improved/u)).toBeTruthy();
    expect(screen.queryByText(/Source 1/u)).toBeNull();
    expect(screen.getByRole("button", { name: "Open source notes.pdf/p2" }))
      .toBeTruthy();
    expect(document.querySelector("code.language-ts")?.textContent).toContain(
      "const  value = 1;",
    );
  });

  it("keeps two same-page citation chips as separate buttons", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "First claim [[cite:1]] and second claim [[cite:2]].",
            citations: [
              {
                chunkType: "page",
                score: 0.9,
                pageCitationPageNumber: 2,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "spacex-s1.pdf",
                  sectionPath: "Page 2",
                },
              },
              {
                chunkType: "page",
                score: 0.88,
                pageCitationPageNumber: 2,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "spacex-s1.pdf",
                  sectionPath: "Page 2",
                },
              },
            ],
          },
        ],
      }),
    );

    expect(
      screen.getAllByRole("button", { name: "Open source spacex-s1.pdf/p2" }),
    ).toHaveLength(2);
    expect(screen.getAllByTestId("citation-chip")).toHaveLength(2);
  });

  it("preserves repeated spaces when there are no citation tokens to remove", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: ["```ts", "const  value = 1;", "```"].join("\n"),
          },
        ],
      }),
    );

    expect(document.querySelector("code.language-ts")?.textContent).toContain(
      "const  value = 1;",
    );
  });

  it("renders image citations as viewable image attachments", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Here is the launch image.",
            citations: [
              {
                chunkType: "image",
                score: 0.9,
                assetUrl: "https://blob.example/images/launch.jpg",
                source: {
                  documentId: "doc_1",
                  sourceFileName: "spacex-s1.pdf",
                  sectionPath: "Assets / images / launch.jpg",
                },
              },
            ],
          },
        ],
      }),
    );

    const image = screen.getByRole("img", {
      name: "spacex-s1.pdf · Assets / images / launch.jpg",
    });
    expect(image.getAttribute("src")).toBe(
      "https://blob.example/images/launch.jpg",
    );
    expect(
      screen.queryByRole("link", {
        name: "https://blob.example/images/launch.jpg",
      }),
    ).toBeNull();
    expect(
      screen.queryByText("https://blob.example/images/launch.jpg"),
    ).toBeNull();
  });

  it("renders selected image artifacts instead of every retrieved image citation", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "已找到相关图片，见下方图片。",
            citations: [
              {
                chunkType: "image",
                score: 0.9,
                assetUrl: "https://blob.example/images/front.jpg",
                source: {
                  documentId: "doc_1",
                  sourceFileName: "商务标文件.pdf",
                  sectionPath: "身份证正面",
                },
              },
              {
                chunkType: "image",
                score: 0.88,
                assetUrl: "https://blob.example/images/back.jpg",
                source: {
                  documentId: "doc_1",
                  sourceFileName: "商务标文件.pdf",
                  sectionPath: "身份证反面",
                },
              },
              {
                chunkType: "image",
                score: 0.7,
                assetUrl: "https://blob.example/images/extra.jpg",
                source: {
                  documentId: "doc_1",
                  sourceFileName: "商务标文件.pdf",
                  sectionPath: "其他候选图片",
                },
              },
            ],
            artifacts: [
              {
                type: "image",
                display: true,
                assetUrl: "https://blob.example/images/front.jpg",
                label: "身份证正面",
              },
              {
                type: "image",
                display: true,
                assetUrl: "https://blob.example/images/back.jpg",
                label: "身份证反面",
              },
            ],
          },
        ],
      }),
    );

    const images = screen.getAllByRole("img");
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "https://blob.example/images/front.jpg",
      "https://blob.example/images/back.jpg",
    ]);
    expect(screen.queryByRole("img", { name: "其他候选图片" })).toBeNull();
  });

  it("renders multi-region answer highlights on displayed page artifacts", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "风险辨识要求建立分级管控制度。",
            artifacts: [
              {
                type: "image",
                display: true,
                assetUrl: "https://blob.example/pages/page-225.png",
                label: "page 225",
                highlightRegions: [
                  { x: 0.1, y: 0.2, w: 0.4, h: 0.1 },
                  { x: 0.2, y: 0.5, w: 0.5, h: 0.12 },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(screen.getByTestId("chat-image-highlights")).toBeTruthy();
    expect(screen.getAllByTestId("chat-image-highlight-region")).toHaveLength(2);
  });

  it("keeps the original image layout when artifacts have no highlight regions", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Here is the page.",
            artifacts: [
              {
                type: "image",
                display: true,
                assetUrl: "https://blob.example/pages/page-1.png",
                label: "page 1",
              },
            ],
          },
        ],
      }),
    );

    const image = screen.getByRole("img", { name: "page 1" });
    expect(image.className).toContain("object-contain");
    expect(image.className).toContain("w-full");
    expect(screen.queryByTestId("chat-image-highlights")).toBeNull();
  });

  it("does not fall back to image citations when a harness message has empty artifacts", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "I could not select a display image.",
            citations: [
              {
                chunkType: "image",
                score: 0.9,
                assetUrl: "https://blob.example/images/candidate.jpg",
                source: {
                  documentId: "doc_1",
                  sourceFileName: "source.pdf",
                  sectionPath: "Candidate image",
                },
              },
            ],
            artifacts: [],
          },
        ],
      }),
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Open source source.pdf",
      }),
    ).toBeTruthy();
  });

  it("renders assistant markdown with GitHub-flavored tables", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content:
              "### Summary\n\n- **Deadline:** Monday\n\n| Item | Status |\n| --- | --- |\n| Draft | Ready |",
          },
        ],
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Summary", level: 3 }),
    ).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toContain("Deadline:");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Ready" })).toBeTruthy();
  });

  it("renders derived table artifacts as structured tables", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "I organized the comparison.",
            artifacts: [
              {
                type: "derived_table",
                ref: "derived:table:plans",
                title: "Plan comparison",
                columns: ["Plan", "Cost"],
                rows: [
                  ["Plan A", "$10M"],
                  ["Plan B", "$8M"],
                ],
                sourceRefs: ["r1:result:1", "r1:result:2"],
                display: true,
                reason: "Comparison requested.",
              },
            ],
          },
        ],
      }),
    );

    expect(screen.getByText("Plan comparison")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Plan" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "$8M" })).toBeTruthy();
  });

  it("keeps user markdown-looking text literal", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "user_1",
            role: "user",
            content: "**Do not render this as bold**",
          },
        ],
      }),
    );

    expect(screen.getByText("**Do not render this as bold**")).toBeTruthy();
    expect(screen.queryByText("Do not render this as bold")).toBeNull();
  });

  it("skips assistant inline HTML while rendering markdown text", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Visible **text** <img src=\"x\" alt=\"hidden image\" />",
          },
        ],
      }),
    );

    expect(screen.getByText("text")).toBeTruthy();
    expect(screen.queryByAltText("hidden image")).toBeNull();
  });

  it("does not hide image cards when source links dedupe the same section", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "这里是相关身份证明图片。",
            citations: [
              {
                chunkType: "text",
                score: 0.9,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "商务标文件.pdf",
                  sectionPath: "二、法定代表人身份证明",
                },
              },
              {
                chunkType: "image",
                score: 0.9,
                assetUrl: "https://blob.example/images/image-6-id-front.jpg",
                source: {
                  documentId: "doc_1",
                  sourceFileName: "商务标文件.pdf",
                  sectionPath: "二、法定代表人身份证明",
                },
              },
            ],
          },
        ],
      }),
    );

    expect(
      screen.getByRole("img", {
        name: "商务标文件.pdf · 二、法定代表人身份证明",
      }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", {
        name: "Open source 商务标文件.pdf",
      }),
    ).toHaveLength(1);
  });

  it("shows thinking progress after existing messages while sending", () => {
    render(
      React.createElement(ChatMessageList, {
        isSending: true,
        messages: [
          {
            id: "user_1",
            role: "user",
            content: "What changed?",
          },
        ],
      }),
    );

    expect(screen.getByRole("status", { name: "Thinking" })).toBeTruthy();
    expect(
      within(screen.getByTestId("chat-scroll")).getByText("What changed?"),
    ).toBeTruthy();
  });

  it("copies visible answer text and keeps export markdown citation-stripped", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Revenue grew [[cite:1]].",
            citations: [
              {
                chunkType: "page",
                score: 0.9,
                pageCitationPageNumber: 26,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "spacex-s1.pdf",
                  sectionPath: "Page 26",
                },
              },
            ],
          },
        ],
        sourceTitlesByDocumentId: { doc_1: "spacex-s1.pdf" },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Copy answer" }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Revenue grew spacex-s1.pdf/p26."),
    );
    expect(writeText.mock.calls[0]?.[0]).not.toContain("[[cite:");
    expect(
      screen.getByRole("button", { name: "Download answer as Markdown" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download answer as PDF" }),
    ).toBeTruthy();
  });
});
