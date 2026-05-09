// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "./chat-panel";

const C = ChatPanel as React.FC<Record<string, unknown>>;

describe("ChatPanel", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("explains answers in plain source-based language", () => {
    const { container } = render(
      React.createElement(C, {
        sourceCount: 2,
      }),
    );

    expect(screen.getByText(/Ask anything about your sources/)).toBeTruthy();
    expect(screen.getByText(/source links/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/grounded|citation/i);
  });

  it("labels assistant evidence as sources used", () => {
    render(
      React.createElement(C, {
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
                  sourceFileName: "syllabus.pdf",
                  sectionPath: "Schedule",
                },
              },
            ],
          },
        ],
      }),
    );

    expect(screen.getByText("Sources used")).toBeTruthy();
    expect(screen.queryByText("Citations")).toBeNull();
  });

  it("uses fluid mobile widths and wraps long chat content", () => {
    render(
      React.createElement(C, {
        messages: [
          {
            id: "user_1",
            role: "user",
            content: "averylongunbrokenquestionthatshouldnotforceafixedmobilewidth",
          },
          {
            id: "assistant_1",
            role: "assistant",
            content: "averylongunbrokenanswerthatshouldwrapinsideasmallviewport",
            citations: [
              {
                chunkType: "text",
                score: 0.9,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "very-long-source-name-that-should-wrap.pdf",
                  sectionPath: "very/long/section/path/that/should/wrap",
                },
              },
            ],
          },
        ],
      }),
    );

    expect(screen.getByTestId("chat-panel").className).toContain("max-w-full");
    expect(screen.getByTestId("chat-panel").className).not.toContain("shrink-0");
    expect(screen.getByTestId("chat-scroll").className).toContain("p-3");
    expect(screen.getByTestId("chat-composer").className).toContain("p-3");
    expect(
      screen.getByText("averylongunbrokenanswerthatshouldwrapinsideasmallviewport")
        .className,
    ).toContain("break-words");
  });

  it("lets users create a fresh chat and recover an old thread", async () => {
    const onNewChat = vi.fn();
    const onThreadSelect = vi.fn();
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        threads: [
          {
            id: "thread_2",
            title: "Revenue question",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
          {
            id: "thread_1",
            title: "Margin question",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
        ],
        activeThreadId: "thread_2",
        onNewChat,
        onThreadSelect,
      }),
    );

    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(onNewChat).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Open chat history" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Open Margin question chat",
      }),
    );

    expect(onThreadSelect).toHaveBeenCalledWith("thread_1");
  });
});
