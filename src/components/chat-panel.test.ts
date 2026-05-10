// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
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
    mockVisibleVirtualViewport();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it("renders citation links as buttons with per-citation loading feedback", async () => {
    const user = userEvent.setup();
    const onCitationClick = vi.fn();

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
        pendingCitationId: "assistant_1:0",
        onCitationClick,
      }),
    );

    const citationButton = screen.getByRole("button", {
      name: "Open source syllabus.pdf · Schedule",
    });

    expect(within(citationButton).getByRole("status", { name: "Loading" }))
      .toBeTruthy();

    await user.click(citationButton);
    expect(onCitationClick).not.toHaveBeenCalled();
  });

  it("does not repeat identical source and description labels", () => {
    render(
      React.createElement(C, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "The document mentions Tesla.",
            citations: [
              {
                chunkType: "text",
                score: 0.9,
                description: "TSLA-Q4-2025-Update.pdf",
                source: {
                  documentId: "doc_1",
                  sourceFileName: "TSLA-Q4-2025-Update.pdf",
                  sectionPath: "TSLA-Q4-2025-Update.pdf",
                },
              },
            ],
          },
        ],
      }),
    );

    expect(
      screen.getByRole("button", {
        name: "Open source TSLA-Q4-2025-Update.pdf",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        "TSLA-Q4-2025-Update.pdf · TSLA-Q4-2025-Update.pdf",
      ),
    ).toBeNull();
  });

  it("uses less-rounded corners for wrapped parsed chunk source links", () => {
    render(
      React.createElement(C, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "The chunk title is long.",
            citations: [
              {
                chunkType: "text",
                score: 0.9,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "TSLA-Q4-2025-UPDATE.PDF",
                  sectionPath:
                    "TABLE-1 TESLA REPORTED 2025 FINANCIAL RESULTS INCLUDING $4.4B OPERATING INCOME AND $14.7B OPERATING CASH FLOW",
                },
              },
            ],
          },
        ],
      }),
    );

    const sourceLink = screen.getByRole("button", {
      name: /Open source TSLA-Q4-2025-UPDATE\.PDF/,
    });

    expect(sourceLink.className).toContain("whitespace-normal");
    expect(sourceLink.className).toContain("rounded-lg");
    expect(sourceLink.className).not.toContain("rounded-full");
  });

  it("shows button-level loading for chat API actions", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        threads: [
          {
            id: "thread_1",
            title: "Revenue question",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
          {
            id: "thread_2",
            title: "Margin question",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
        ],
        activeThreadId: "thread_2",
        onNewChat: vi.fn(),
        onThreadSelect: vi.fn(),
        onThreadArchive: vi.fn(),
        isSending: true,
        isCreatingThread: true,
        loadingThreadId: "thread_1",
        archivingThreadIds: ["thread_2"],
      }),
    );

    expect(
      within(screen.getByRole("button", { name: "Send message" })).getByRole(
        "status",
        { name: "Loading" },
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("button", { name: "New chat" })).getByRole(
        "status",
        { name: "Loading" },
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Open chat history" }));

    expect(
      within(
        await screen.findByRole("button", {
          name: "Open Revenue question chat",
        }),
      ).getByRole("status", { name: "Loading" }),
    ).toBeTruthy();
    expect(
      within(
        await screen.findByRole("button", {
          name: "Delete Margin question chat",
        }),
      ).getByRole("status", { name: "Loading" }),
    ).toBeTruthy();
  });

  it("replaces the disabled guest composer with a login button", async () => {
    const onLoginClick = vi.fn();
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        isDisabled: true,
        onLoginClick,
      }),
    );

    expect(
      screen.queryByPlaceholderText("Upload a document to start asking questions."),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).toBeNull();

    const loginButton = screen.getByRole("button", {
      name: "Log in to start",
    });
    expect(loginButton.className).toContain("bg-[#8E51FF]");
    expect(loginButton.className).toContain("border-b-[4px]");
    expect(loginButton.className).toContain("font-mono-readable");

    await user.click(loginButton);
    expect(onLoginClick).toHaveBeenCalledOnce();
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

function mockVisibleVirtualViewport(): void {
  vi.spyOn(window.HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function getOffsetHeight(this: HTMLElement): number {
      if (this.hasAttribute("data-radix-scroll-area-viewport")) return 720;
      if (this.hasAttribute("data-index")) return 160;
      return 1;
    });
  vi.spyOn(window.HTMLElement.prototype, "offsetWidth", "get")
    .mockImplementation((): number => 720);
}
