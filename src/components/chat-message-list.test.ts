// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
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
        name: "Open source 商务标文件.pdf · 二、法定代表人身份证明",
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
