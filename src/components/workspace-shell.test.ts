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

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => ({
  upload: mocks.uploadBlob,
}));

const C = WorkspaceShell as React.FC<Record<string, unknown>>;

describe("WorkspaceShell", () => {
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("keeps desktop panels horizontally scrollable at their minimum widths", () => {
    render(React.createElement(C, { sources: [] }));

    const layout = screen.getByTestId("desktop-panel-layout");
    const panels = screen.getByTestId("desktop-resizable-panels");
    const sourcesPanel = screen.getByTestId("desktop-sources-panel");

    const minimumTotalWidth =
      DESKTOP_PANEL_MIN_WIDTHS.sources +
      DESKTOP_PANEL_MIN_WIDTHS.chat +
      DESKTOP_PANEL_GUTTER_WIDTH;

    expect(layout.className).toContain("overflow-x-auto");
    expect(panels.style.minWidth).toBe(`${minimumTotalWidth}px`);
    expect(sourcesPanel.style.width).toBe("350px");
  });

  it("lets desktop users resize neighboring panels and collapse sources below the threshold", () => {
    render(React.createElement(C, { sources: [] }));

    const firstHandle = screen.getByRole("separator", {
      name: "Resize sources and chat",
    });
    const sourcesPanel = screen.getByTestId("desktop-sources-panel");

    fireEvent.pointerDown(firstHandle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 120 });
    fireEvent.pointerUp(window);

    expect(sourcesPanel.style.width).toBe("470px");

    fireEvent.pointerDown(firstHandle, { clientX: 120 });
    fireEvent.pointerMove(window, { clientX: -1000 });
    fireEvent.pointerUp(window);

    expect(screen.getByTestId("desktop-sources-panel").style.width).toBe(
      "72px",
    );
    expect(
      screen.getByRole("button", { name: "Show sources panel" }),
    ).toBeTruthy();
  });

  it("shows the first ready document chunks on workspace load", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = getRequestURL(input);

      if (url.pathname === "/api/sources/source_1/chunks") {
        return Response.json({
          chunks: [
            {
              chunkId: "source_1:chunk_1",
              documentId: "doc_1",
              sectionPath: "Overview",
              type: "text",
              content: "First document chunk content.",
              sourceTitle: "first.pdf",
            },
          ],
          pagination: {
            page: Number(url.searchParams.get("page") ?? "1"),
            pageSize: 100,
            total: 1,
            totalPages: 1,
          },
        });
      }

      return Response.json({ message: "Unexpected request" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    render(
      React.createElement(C, {
        chunkViewDocumentId: "doc_1",
        sources: [
          {
            id: "source_1",
            title: "first.pdf",
            status: "ready",
            documentId: "doc_1",
          },
          {
            id: "source_2",
            title: "second.pdf",
            status: "ready",
            documentId: "doc_2",
          },
        ],
      }),
    );

    // chunkViewDocumentId auto-opens the chunks overlay; expand to see the chunk.
    await waitFor(() => {
      expect(screen.getByText("Overview")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Overview"));
    await waitFor(() => {
      expect(
        screen.getByText("First document chunk content."),
      ).toBeTruthy();
    });
    expect(countFetches(fetch, "/api/sources/source_1/chunks")).toBe(1);
    expect(countFetches(fetch, "/api/sources/source_2/chunks")).toBe(0);
  });

  it("reuses loaded chunks when users click another citation from the same source", async () => {
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

    await desktopChatPanel.findAllByRole("button", {
      name: "Open source doc.pdf",
    });
    const citationButtons = desktopChatPanel.getAllByRole(
      "button",
      {
        name: "Open source doc.pdf",
      },
    );
    expect(citationButtons).toHaveLength(2);
    const firstCitation = citationButtons[0] as HTMLButtonElement;
    const secondCitation = citationButtons[1] as HTMLButtonElement;
    await user.click(firstCitation);

    await waitFor(() => {
      expect(
        countFetches(fetch, "/api/sources/source_1/chunks"),
      ).toBeGreaterThan(0);
    });
    await waitFor(() => {
      const topRow = screen
        .getByTestId("chunks-panel")
        .querySelector<HTMLElement>('[data-index="0"]');

      expect(topRow?.getAttribute("data-chunk-id")).toBe("chunk_1");
      expect(topRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
    expect(countFetches(fetch, "/api/sources/source_1/chunks")).toBe(1);

    await waitFor(() => {
      expect(secondCitation.disabled).toBe(false);
    });
    await user.click(secondCitation);

    await waitFor(() => {
      const topRow = screen
        .getByTestId("chunks-panel")
        .querySelector<HTMLElement>('[data-index="0"]');

      expect(topRow?.getAttribute("data-chunk-id")).toBe("chunk_2");
      expect(topRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
    expect(countFetches(fetch, "/api/sources/source_1/chunks")).toBe(1);
  });

  it("runs the citation jump again when users click the same source link twice", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const path = getRequestPath(input);

      if (path === "/api/chat") {
        return Response.json({
          threadId: "thread_1",
          messages: [
            {
              id: "assistant_1",
              role: "assistant",
              content: "The answer uses one section.",
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

    await user.type(input, "Where?");
    await user.click(sendButton);

    const citation = await desktopChatPanel.findByRole("button", {
      name: "Open source doc.pdf",
    });
    await user.click(citation);
    await waitFor(() => {
      const topRow = screen
        .getByTestId("chunks-panel")
        .querySelector<HTMLElement>('[data-index="0"]');

      expect(topRow?.getAttribute("data-chunk-id")).toBe("chunk_1");
      expect(topRow?.getAttribute("data-focused-chunk")).toBe("true");
    });

    await user.click(citation);
    await waitFor(() => {
      const topRow = screen
        .getByTestId("chunks-panel")
        .querySelector<HTMLElement>('[data-index="0"]');

      expect(topRow?.getAttribute("data-chunk-id")).toBe("chunk_1");
      expect(topRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
    expect(countFetches(fetch, "/api/sources/source_1/chunks")).toBe(1);
  });

  it("does not reuse partial chunk pages for ambiguous citation jumps", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = getRequestURL(input);

      if (url.pathname === "/api/sources/source_1/chunks" && url.search) {
        const page = url.searchParams.get("page");
        return Response.json({
          chunks:
            page === "1"
              ? [
                  {
                    chunkId: "loaded_wrong_chunk",
                    documentId: "doc_1",
                    sectionPath: "Repeated",
                    type: "text",
                    content: "Loaded page text with the same section path.",
                    sourceTitle: "doc.pdf",
                  },
                ]
              : [],
          pagination: {
            page: Number(page ?? "1"),
            pageSize: 100,
            total: 200,
            totalPages: 2,
          },
        });
      }

      if (url.pathname === "/api/sources/source_1/chunks") {
        return Response.json({
          chunks: [
            {
              chunkId: "loaded_wrong_chunk",
              documentId: "doc_1",
              sectionPath: "Repeated",
              type: "text",
              content: "Loaded page text with the same section path.",
              sourceTitle: "doc.pdf",
            },
            {
              chunkId: "unloaded_exact_chunk",
              documentId: "doc_1",
              sectionPath: "Repeated",
              type: "text",
              content: "Exact cited text from an unloaded page.",
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
            chunkCount: 200,
          },
        ],
        chatThreads: [
          {
            id: "thread_1",
            title: "Current chat",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
        ],
        activeChatThreadId: "thread_1",
        chatMessages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "The answer cites an unloaded chunk.",
            citations: [
              {
                content: "Exact cited text from an unloaded page.",
                chunkType: "text",
                score: 0.91,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "doc.pdf",
                  sectionPath: "Repeated",
                },
              },
            ],
          },
        ],
      }),
    );

    const desktopSourcesPanel = within(screen.getByTestId("desktop-sources-panel"));
    await user.click(
      desktopSourcesPanel.getByRole("button", {
        name: "Open doc.pdf parsed chunks",
      }),
    );
    await waitFor(() => {
      expect(
        countFetchesWithSearch(fetch, "/api/sources/source_1/chunks", "?page=1&pageSize=50"),
      ).toBeGreaterThan(0);
    });

    const desktopChatPanel = within(screen.getByTestId("desktop-chat-panel"));
    await user.click(
      desktopChatPanel.getByRole("button", {
        name: "Open source doc.pdf",
      }),
    );

    await waitFor(() => {
      expect(
        countFetchesWithSearch(fetch, "/api/sources/source_1/chunks", ""),
      ).toBe(1);
    });
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

  it("revalidates sources from the API after upload instead of only trusting the upload response", async () => {
    mocks.uploadBlob.mockResolvedValue(makeUploadedBlob());
    vi.stubGlobal("crypto", { randomUUID: () => "upload_1" });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = getRequestPath(input);

      if (path === "/api/sources" && init?.method === "POST") {
        return Response.json(
          {
            source: {
              id: "source_1",
              title: "upload-response.pdf",
              status: "parsing",
              mimeType: "application/pdf",
              chunkCount: 0,
              originalFile: {
                url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
                mimeType: "application/pdf",
              },
            },
          },
          { status: 201 },
        );
      }

      if (path === "/api/sources") {
        return Response.json({
          sources: [
            {
              id: "source_1",
              title: "server-normalized.pdf",
              status: "ready",
              documentId: "doc_1",
              mimeType: "application/pdf",
              chunkCount: 4,
              originalFile: {
                url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
                mimeType: "application/pdf",
              },
            },
          ],
        });
      }

      return Response.json({ message: "Unexpected request" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();

    render(React.createElement(C, { sources: [] }));

    await user.click(screen.getAllByRole("button", { name: "Upload Document" })[0]!);
    const input = document.querySelector("input[type='file']");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Upload input was not rendered.");
    }

    await user.upload(
      input,
      new File(["hello"], "notes.pdf", { type: "application/pdf" }),
    );
    const form = document.querySelector("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Upload form was not rendered.");
    }
    fireEvent.submit(form);

    expect((await screen.findAllByText("server-normalized.pdf")).length).toBeGreaterThan(0);
    expect(screen.queryByText("upload-response.pdf")).toBeNull();
    expect(countFetches(fetch, "/api/sources")).toBeGreaterThanOrEqual(2);
  });

  it("keeps remaining initial sources visible after deleting one source", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://localhost").toString(), init);
      const path = getRequestPath(request);

      if (path === "/api/sources/source_1" && request.method === "PATCH") {
        return Response.json({ id: "source_1", archived: true });
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
            title: "first.pdf",
            status: "ready",
            documentId: "doc_1",
          },
          {
            id: "source_2",
            title: "second.pdf",
            status: "ready",
            documentId: "doc_2",
          },
        ],
      }),
    );

    const desktopSourcesPanel = within(
      screen.getByTestId("desktop-sources-panel"),
    );
    await user.click(
      desktopSourcesPanel.getByRole("button", { name: "Delete first.pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(desktopSourcesPanel.queryByText("first.pdf")).toBeNull();
    });
    expect(desktopSourcesPanel.getByText("second.pdf")).toBeTruthy();
    expect(desktopSourcesPanel.queryByText("No sources yet.")).toBeNull();
  });

  it("uses cached chat data when reopening a previously loaded thread", async () => {
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

      if (path === "/api/chat/threads/thread_1") {
        return Response.json({
          thread: {
            id: "thread_1",
            title: "Current chat",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
          messages: [
            {
              id: "message_current",
              role: "assistant",
              content: "Current answer.",
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

    await user.click(
      desktopChatPanel.getByRole("button", { name: "Open chat history" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Open Current chat chat" }),
    );
    await desktopChatPanel.findByText("Current answer.");

    await user.click(
      desktopChatPanel.getByRole("button", { name: "Open chat history" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Open Older chat chat" }),
    );
    await desktopChatPanel.findByText("Recovered from history.");

    expect(countFetches(fetch, "/api/chat/threads/thread_2")).toBe(1);
  });
});

function getRequestPath(input: RequestInfo | URL): string {
  return getRequestURL(input).pathname;
}

function getRequestURL(input: RequestInfo | URL): URL {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return new URL(url, "http://localhost");
}

function countFetches(
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
  url: string,
): number {
  return fetch.mock.calls.filter(([input]) => getRequestPath(input) === url)
    .length;
}

function countFetchesWithSearch(
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
  path: string,
  search: string,
): number {
  return fetch.mock.calls.filter(([input]) => {
    const url = getRequestURL(input);
    return url.pathname === path && url.search === search;
  }).length;
}

function makeUploadedBlob(): {
  readonly url: string;
  readonly downloadUrl: string;
  readonly pathname: string;
  readonly contentType: string;
  readonly contentDisposition: string;
  readonly etag: string;
} {
  return {
    url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
    downloadUrl:
      "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf?download=1",
    pathname: "source-uploads/upload_1/document.pdf",
    contentType: "application/pdf",
    contentDisposition: 'attachment; filename="document.pdf"',
    etag: "etag_1",
  };
}

function mockVisibleVirtualViewport(): void {
  vi.spyOn(window.HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function getOffsetHeight(this: HTMLElement): number {
      if (this.hasAttribute("data-radix-scroll-area-viewport")) return 720;
      if (this.hasAttribute("data-index")) return 180;
      return 1;
    });
  vi.spyOn(window.HTMLElement.prototype, "offsetWidth", "get")
    .mockImplementation((): number => 720);
}
