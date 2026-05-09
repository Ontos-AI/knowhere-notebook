// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DESKTOP_PANEL_GUTTER_WIDTH,
  DESKTOP_PANEL_MIN_WIDTHS,
  WorkspaceShell,
} from "./workspace-shell";

const C = WorkspaceShell as React.FC<Record<string, unknown>>;

describe("WorkspaceShell", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps desktop panels horizontally scrollable at their minimum widths", () => {
    render(React.createElement(C, { sources: [] }));

    const layout = screen.getByTestId("desktop-panel-layout");
    const panels = screen.getByTestId("desktop-resizable-panels");
    const chunksPanel = screen.getByTestId("desktop-chunks-panel");

    const minimumTotalWidth =
      DESKTOP_PANEL_MIN_WIDTHS.sources +
      DESKTOP_PANEL_MIN_WIDTHS.chunks +
      DESKTOP_PANEL_MIN_WIDTHS.chat +
      DESKTOP_PANEL_GUTTER_WIDTH * 2;

    expect(layout.className).toContain("overflow-x-auto");
    expect(panels.style.minWidth).toBe(`${minimumTotalWidth}px`);
    expect(chunksPanel.style.minWidth).toBe(
      `${DESKTOP_PANEL_MIN_WIDTHS.chunks}px`,
    );
  });

  it("lets desktop users resize neighboring panels without folding below minimum widths", () => {
    render(React.createElement(C, { sources: [] }));

    const firstHandle = screen.getByRole("separator", {
      name: "Resize sources and parsed chunks",
    });
    const sourcesPanel = screen.getByTestId("desktop-sources-panel");
    const chunksPanel = screen.getByTestId("desktop-chunks-panel");

    fireEvent.pointerDown(firstHandle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 120 });
    fireEvent.pointerUp(window);

    expect(sourcesPanel.style.width).toBe("440px");
    expect(chunksPanel.style.width).toBe("600px");

    fireEvent.pointerDown(firstHandle, { clientX: 120 });
    fireEvent.pointerMove(window, { clientX: -1000 });
    fireEvent.pointerUp(window);

    expect(sourcesPanel.style.width).toBe(
      `${DESKTOP_PANEL_MIN_WIDTHS.sources}px`,
    );
  });

  it("reuses loaded chunks when users click another citation from the same source", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const path = getRequestPath(input);

      if (path === "/api/chat") {
        return Response.json({
          threadId: "thread_1",
          messages: [
            {
              id: "assistant_1",
              role: "assistant",
              content: "The answer uses two sections.",
              citations: [
                {
                  content: "First cited section",
                  chunkType: "text",
                  score: 0.91,
                  source: {
                    documentId: "doc_1",
                    sourceFileName: "doc.pdf",
                    sectionPath: "First",
                  },
                },
                {
                  content: "Second cited section",
                  chunkType: "text",
                  score: 0.9,
                  source: {
                    documentId: "doc_1",
                    sourceFileName: "doc.pdf",
                    sectionPath: "Second",
                  },
                },
              ],
            },
          ],
        });
      }

      if (path === "/api/sources/source_1/chunks") {
        return Response.json({
          chunks: [
            {
              chunkId: "chunk_1",
              documentId: "doc_1",
              sectionPath: "First",
              type: "text",
              content: "First cited section",
              sourceTitle: "doc.pdf",
            },
            {
              chunkId: "chunk_2",
              documentId: "doc_1",
              sectionPath: "Second",
              type: "text",
              content: "Second cited section",
              sourceTitle: "doc.pdf",
            },
          ],
        });
      }

      return Response.json({ message: "Unexpected request" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        sources: [
          {
            id: "source_1",
            title: "doc.pdf",
            status: "ready",
            documentId: "doc_1",
          },
        ],
      }),
    );

    const desktopChatPanel = within(screen.getByTestId("desktop-chat-panel"));
    const input = desktopChatPanel.getByPlaceholderText(
      "Ask a question about your documents…",
    );
    const sendButton = desktopChatPanel.getByRole("button", {
      name: "Send message",
    });

    await user.type(input, "What changed?");
    await waitFor(() => {
      expect((sendButton as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(sendButton);

    const firstCitation = await desktopChatPanel.findByText("doc.pdf · First");
    await user.click(firstCitation);

    await waitFor(() => {
      expect(
        countFetches(fetch, "/api/sources/source_1/chunks"),
      ).toBeGreaterThan(0);
    });
    expect(countFetches(fetch, "/api/sources/source_1/chunks")).toBe(1);
    const scrollsAfterFirstCitation = scrollIntoView.mock.calls.length;

    await user.click(desktopChatPanel.getByText("doc.pdf · Second"));

    await waitFor(() => {
      expect(scrollIntoView.mock.calls.length).toBeGreaterThan(
        scrollsAfterFirstCitation,
      );
    });
    expect(countFetches(fetch, "/api/sources/source_1/chunks")).toBe(1);
  });

  it("renders the most recent recovered chat on workspace load", () => {
    render(
      React.createElement(C, {
        sources: [
          {
            id: "source_1",
            title: "doc.pdf",
            status: "ready",
            documentId: "doc_1",
          },
        ],
        chatThreads: [
          {
            id: "thread_1",
            title: "Recovered chat",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
        ],
        activeChatThreadId: "thread_1",
        chatMessages: [
          {
            id: "message_1",
            role: "user",
            content: "What did we ask before?",
          },
          {
            id: "message_2",
            role: "assistant",
            content: "This is the recovered answer.",
          },
        ],
      }),
    );

    const desktopChatPanel = within(screen.getByTestId("desktop-chat-panel"));

    expect(desktopChatPanel.getByText("What did we ask before?")).toBeTruthy();
    expect(desktopChatPanel.getByText("This is the recovered answer.")).toBeTruthy();
  });

  it("loads an old chat when selected from history", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const path = getRequestPath(input);

      if (path === "/api/chat/threads/thread_2") {
        return Response.json({
          thread: {
            id: "thread_2",
            title: "Older chat",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
          messages: [
            {
              id: "message_old",
              role: "assistant",
              content: "Recovered from history.",
            },
          ],
        });
      }

      return Response.json({ message: "Unexpected request" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        sources: [
          {
            id: "source_1",
            title: "doc.pdf",
            status: "ready",
            documentId: "doc_1",
          },
        ],
        chatThreads: [
          {
            id: "thread_1",
            title: "Current chat",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
          {
            id: "thread_2",
            title: "Older chat",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
        ],
        activeChatThreadId: "thread_1",
        chatMessages: [
          {
            id: "message_current",
            role: "assistant",
            content: "Current answer.",
          },
        ],
      }),
    );

    const desktopChatPanel = within(screen.getByTestId("desktop-chat-panel"));

    await user.click(
      desktopChatPanel.getByRole("button", { name: "Open chat history" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Open Older chat chat" }),
    );

    await desktopChatPanel.findByText("Recovered from history.");
    expect(desktopChatPanel.queryByText("Current answer.")).toBeNull();
    expect(countFetches(fetch, "/api/chat/threads/thread_2")).toBe(1);
  });
});

function getRequestPath(input: RequestInfo | URL): string {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return new URL(url, "http://localhost").pathname;
}

function countFetches(
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
  url: string,
): number {
  return fetch.mock.calls.filter(([input]) => getRequestPath(input) === url)
    .length;
}
