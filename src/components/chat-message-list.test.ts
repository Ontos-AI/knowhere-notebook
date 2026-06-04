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
