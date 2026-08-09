// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  function expandSection(title: string): void {
    const trigger = screen.getByRole("button", {
      name: new RegExp(`^${title}`),
    });
    fireEvent.click(trigger);
  }

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
      screen.getByRole("button", { name: "Sources1" }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");

    expandSection("Sources");

    expect(
      screen.getByRole("button", { name: "Open source Syllabus.pdf" }),
    ).toBeTruthy();
  });

  it("renders the transient retrieval trace for a fresh assistant message", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "The deadline is Monday.",
            retrievalTrace: {
              durationSeconds: 1.2,
              llmCallCount: 5,
              inputTokens: 820,
              outputTokens: 414,
              queries: [
                {
                  query: "deadline monday",
                  namespace: "notebook-workspace",
                  resultCount: 3,
                  referencedChunkCount: 1,
                  topScores: [0.91, 0.8],
                },
              ],
            },
          },
        ],
      }),
    );

    expandSection("Retrieval");

    expect(screen.getByText("1.2s · 5 LLM calls · 820 in · 414 out")).toBeTruthy();
    expect(screen.getByText("deadline monday")).toBeTruthy();
    expect(screen.getByText("3 hits")).toBeTruthy();
    expect(screen.getByText("1 cited chunk")).toBeTruthy();
    expect(screen.getByText("top score: 0.910 · 0.800")).toBeTruthy();
  });

  it("does not render answer stats when the trace has no stat fields", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "The deadline is Monday.",
            retrievalTrace: {
              queries: [
                {
                  query: "deadline monday",
                  namespace: "notebook-workspace",
                  resultCount: 0,
                  referencedChunkCount: 0,
                  topScores: [],
                },
              ],
            },
          },
        ],
      }),
    );

    expandSection("Retrieval");

    expect(screen.queryByText(/s ·/u)).toBeNull();
    expect(screen.queryByText(/in ·/u)).toBeNull();
  });

  it("does not render a retrieval trace without queries", () => {
    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "The deadline is Monday.",
            retrievalTrace: { queries: [] },
          },
        ],
      }),
    );

    expect(screen.queryByText("Retrieval")).toBeNull();
  });

  it("renders citations in a bottom source area as file chips and inline markers as links", async () => {
    const user = userEvent.setup();
    const onCitationClick = vi.fn();

    render(
      React.createElement(ChatMessageList, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: [
              "Capital expenditure appears in the appendix. [Source 1: spacex-s1.pdf / Assets / tables / table-25 Capital Expenditures.html]",
              "Drivers are discussed elsewhere. [Source 3: spacex-s1.pdf / MD&A / Drivers of Our Performance]",
            ].join("\n\n"),
            citations: [
              {
                chunkType: "table",
                score: 0.9,
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
                source: {
                  documentId: "doc_1",
                  sourceFileName: "spacex-s1.pdf",
                  sectionPath: "MD&A / Drivers of Our Performance",
                },
              },
            ],
          },
        ],
        onCitationClick,
      }),
    );

    expect(
      screen.getByText((text) => text.startsWith("Capital expenditure appears")),
    ).toBeTruthy();
    // Inline markers become [n] links instead of being stripped.
    const inlineLinks = screen.getAllByRole("button", {
      name: /^Open referenced chunk /u,
    });
    expect(inlineLinks).toHaveLength(2);
    expect(inlineLinks[0]!.textContent).toBe("1");
    expect(inlineLinks[1]!.textContent).toBe("3");

    await user.click(inlineLinks[0]!);
    expect(onCitationClick).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ documentId: "doc_1" }),
      }),
      "assistant_1:0",
    );

    expandSection("Sources");
    const sourceChips = screen.getAllByRole("button", {
      name: "Open source spacex-s1.pdf",
    });

    expect(sourceChips).toHaveLength(2);

    await user.hover(sourceChips[0]!);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe(
      "spacex-s1.pdf · Assets / tables / table-25 Capital Expenditures.htmlScore: 0.900",
    );
  });

  it("converts description-only source labels into inline links without changing other markdown whitespace", () => {
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
                source: {
                  documentId: "doc_1",
                  sourceFileName: "notes.pdf",
                  sectionPath: "Revenue",
                },
              },
            ],
          },
        ],
        onCitationClick: vi.fn(),
      }),
    );

    expect(screen.getByText((text) => text.startsWith("Revenue improved"))).toBeTruthy();
    const inlineLink = screen.getByRole("button", {
      name: "Open referenced chunk assistant_1:0",
    });
    expect(inlineLink.textContent).toBe("1");
    expect(document.querySelector("code.language-ts")?.textContent).toContain(
      "const  value = 1;",
    );
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
    expandSection("Sources");
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
    expandSection("Sources");
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
});
