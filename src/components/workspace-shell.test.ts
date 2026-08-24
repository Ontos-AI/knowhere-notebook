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
    const chunksPanel = screen.getByTestId("desktop-chunks-panel");

    const minimumTotalWidth =
      DESKTOP_PANEL_MIN_WIDTHS.sources +
      DESKTOP_PANEL_MIN_WIDTHS.chunks +
      DESKTOP_PANEL_MIN_WIDTHS.chat +
      DESKTOP_PANEL_GUTTER_WIDTH * 2;

    expect(layout.className).toContain("overflow-x-auto");
    expect(panels.style.minWidth).toBe(`${minimumTotalWidth}px`);
    expect(sourcesPanel.style.width).toBe("350px");
    expect(chunksPanel.style.minWidth).toBe(
      `${DESKTOP_PANEL_MIN_WIDTHS.chunks}px`,
    );
  });

  it("lets desktop users resize neighboring panels and collapse sources below the threshold", () => {
    render(React.createElement(C, { sources: [] }));

    const firstHandle = screen.getByRole("separator", {
      name: "Resize sources and parsed chunks",
    });
    const sourcesPanel = screen.getByTestId("desktop-sources-panel");
    const chunksPanel = screen.getByTestId("desktop-chunks-panel");

    fireEvent.pointerDown(firstHandle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 120 });
    fireEvent.pointerUp(window);

    expect(sourcesPanel.style.width).toBe("470px");
    expect(chunksPanel.style.width).toBe("600px");

    const resizedHandle = screen.getByRole("separator", {
      name: "Resize sources and parsed chunks",
    });
    fireEvent.pointerDown(resizedHandle, { clientX: 120 });
    fireEvent.pointerMove(window, { clientX: -1000 });
    fireEvent.pointerUp(window);

    expect(screen.getByTestId("desktop-sources-panel").style.width).toBe(
      "72px",
    );
    expect(
      screen.getByRole("button", { name: "Show sources panel" }),
    ).toBeTruthy();
  });

  it("lets desktop users expand the chat panel by shrinking parsed chunks further", () => {
    render(React.createElement(C, { sources: [] }));

    const secondHandle = screen.getByRole("separator", {
      name: "Resize parsed chunks and chat",
    });
    const chunksPanel = screen.getByTestId("desktop-chunks-panel");
    const chatPanel = screen.getByTestId("desktop-chat-panel");

    fireEvent.pointerDown(secondHandle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: -500 });
    fireEvent.pointerUp(window);

    expect(chunksPanel.style.width).toBe("480px");
    expect(chatPanel.style.width).toBe("660px");
  });

  it("uses rendered panel widths when resizing the flex-grown middle panel", () => {
    render(React.createElement(C, { sources: [] }));

    const secondHandle = screen.getByRole("separator", {
      name: "Resize parsed chunks and chat",
    });
    const chunksPanel = screen.getByTestId("desktop-chunks-panel");
    const chatPanel = screen.getByTestId("desktop-chat-panel");
    vi.spyOn(chunksPanel, "getBoundingClientRect").mockReturnValue(
      createElementRect(1100),
    );
    vi.spyOn(chatPanel, "getBoundingClientRect").mockReturnValue(
      createElementRect(420),
    );

    fireEvent.pointerDown(secondHandle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: -900 });
    fireEvent.pointerUp(window);

    expect(chunksPanel.style.width).toBe("480px");
    expect(chatPanel.style.width).toBe("1040px");
  });

  it("shows a login CTA instead of the chat composer for guests", () => {
    render(
      React.createElement(C, {
        isGuest: true,
        loginUrl: "/login",
        sources: [
          {
            id: "source_1",
            title: "demo.pdf",
            status: "ready",
            documentId: "doc_1",
          },
        ],
      }),
    );

    const desktopChatPanel = within(screen.getByTestId("desktop-chat-panel"));

    expect(
      desktopChatPanel.queryByPlaceholderText(
        "Ask a question about your documents…",
      ),
    ).toBeNull();
    expect(
      desktopChatPanel.getByRole("button", { name: "Log in to start" }),
    ).toBeTruthy();
  });

  it("lets guests open the Official Library from the sources panel", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        isGuest: true,
        loginUrl: "/login",
        sources: [],
        officialLibrarySources: [
          {
            librarySourceId: "stem-transformers",
            categoryId: "stem-books",
            categoryLabel: "STEM books",
            title: "Transformers.pdf",
            sourceUrl: "https://example.com/transformers.pdf",
            mimeType: "application/pdf",
            status: "ready",
            demoSourceId: "demo-transformers",
          },
        ],
      }),
    );

    const desktopSourcesPanel = within(
      screen.getByTestId("desktop-sources-panel"),
    );
    await user.click(
      desktopSourcesPanel.getByRole("button", { name: "Open library" }),
    );

    const desktopLibraryPanel = within(
      within(screen.getByTestId("desktop-chunks-panel")).getByTestId(
        "official-library-panel",
      ),
    );
    expect(desktopLibraryPanel.getByRole("heading", { name: "Library" }))
      .toBeTruthy();
    expect(
      desktopLibraryPanel.getByRole("button", { name: "Open STEM books" }),
    ).toBeTruthy();
    await user.click(
      desktopLibraryPanel.getByRole("button", { name: "Back to sources" }),
    );
    expect(
      within(screen.getByTestId("desktop-chunks-panel")).queryByTestId(
        "official-library-panel",
      ),
    ).toBeNull();
    expect(window.location.href).not.toContain("/login");
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

    const desktopChunksPanel = within(screen.getByTestId("desktop-chunks-panel"));
    await waitFor(() => {
      expect(
        desktopChunksPanel.getByText("First document chunk content."),
      ).toBeTruthy();
    });
    expect(countFetches(fetch, "/api/sources/source_1/chunks")).toBe(1);
    expect(countFetches(fetch, "/api/sources/source_2/chunks")).toBe(0);
  });

  it("keeps a remote document open without refreshing sources after chunks load", async () => {
    const remoteSourceId = "knowhere-doc:default:doc_remote";
    const encodedRemoteSourceId = encodeURIComponent(remoteSourceId);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = getRequestURL(input);

      if (
        url.pathname === `/api/sources/${encodedRemoteSourceId}/chunks`
      ) {
        return Response.json({
          chunks: [
            {
              chunkId: "remote_page_1",
              documentId: "doc_remote",
              sectionPath: "Page 1",
              type: "page",
              content: "Remote page summary.",
              sourceTitle: "remote.pdf",
              pageNums: [1],
              pageAssets: [
                {
                  pageNumber: 1,
                  assetUrl: "https://assets.example/page-1.png",
                  contentType: "image/png",
                },
              ],
            },
          ],
          pagination: {
            page: Number(url.searchParams.get("page") ?? "1"),
            pageSize: 50,
            total: 1,
            totalPages: 1,
          },
        });
      }

      if (url.pathname === "/api/sources") {
        return Response.json({
          sources: [
            {
              id: "source_localized",
              kind: "workspace",
              title: "remote.pdf",
              status: "ready",
              documentId: "doc_remote",
            },
          ],
        });
      }

      return Response.json({ message: "Unexpected request" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    render(
      React.createElement(C, {
        sources: [
          {
            id: remoteSourceId,
            kind: "remote",
            title: "remote.pdf",
            status: "ready",
            documentId: "doc_remote",
            excludedFromQuery: false,
          },
        ],
      }),
    );

    const desktopChunksPanel = within(screen.getByTestId("desktop-chunks-panel"));
    await waitFor(() => {
      expect(desktopChunksPanel.getByRole("button", { name: "List" })).toBeTruthy();
    });
    fireEvent.click(desktopChunksPanel.getByRole("button", { name: "List" }));
    await waitFor(() => {
      expect(desktopChunksPanel.getByRole("img", { name: "Page 1" }))
        .toBeTruthy();
    });

    expect(countFetches(fetch, "/api/sources")).toBe(0);
    expect(
      countFetches(
        fetch,
        `/api/sources/${encodedRemoteSourceId}/chunks`,
      ),
    ).toBe(1);
  });

  it("focuses guest citations on desktop using loaded demo chunks", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = getRequestURL(input);

      if (url.pathname === "/api/sources/demo-source/chunks") {
        return Response.json({
          chunks: [
            {
              chunkId: "demo-source:chunk_1",
              documentId: "doc_1",
              sectionPath: "Demo",
              type: "text",
              content: "Demo cited section",
              sourceTitle: "demo.pdf",
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
        isGuest: true,
        sources: [
          {
            id: "demo-source",
            title: "demo.pdf",
            status: "ready",
            documentId: "doc_1",
          },
        ],
        chatMessages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Demo answer.",
            citations: [
              {
                content: "Demo cited section",
                description: "Demo citation",
                chunkType: "text",
                score: 0.91,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "demo.pdf",
                  sectionPath: "Demo",
                },
              },
            ],
          },
        ],
      }),
    );

    const citationButton = await findStableConnectedElement(() => {
      const desktopChatPanel = within(screen.getByTestId("desktop-chat-panel"));
      return desktopChatPanel.getByRole("button", {
        name: "Open source demo.pdf",
      });
    });
    fireEvent.click(citationButton);

    await waitFor(() => {
      const topRow = screen
        .getByTestId("desktop-chunks-panel")
        .querySelector<HTMLElement>('[data-index="0"]');

      expect(topRow?.getAttribute("data-chunk-id")).toBe("demo-source:chunk_1");
      expect(topRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
    expect(
      fetch.mock.calls.some(([input]) =>
        getRequestPath(input).startsWith("/demo-sources/"),
      ),
    ).toBe(false);
  });

  it("focuses guest Official Library demo citations instead of the empty login state", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = getRequestURL(input);

      if (url.pathname === "/api/sources/demo-tsla-q4-2025/chunks") {
        return Response.json({
          chunks: [
            {
              chunkId: "demo-tsla-q4-2025:chunk_1",
              documentId: "demo-doc-tsla-q4-2025",
              sectionPath: "TSLA-Q4-2025-Update.pdf/OTHER UPDATES",
              type: "text",
              content: "Tesla entered into an agreement to invest approximately",
              sourceTitle: "TSLA-Q4-2025-Update.pdf",
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
        isGuest: true,
        sources: [
          {
            id: "demo-tsla-q4-2025",
            kind: "demo",
            demoSourceId: "demo-tsla-q4-2025",
            title: "TSLA-Q4-2025-Update.pdf",
            status: "ready",
            mimeType: "application/pdf",
            documentId: "demo-doc-tsla-q4-2025",
            officialLibrary: {
              librarySourceId: "financial-tsla-q4-2025",
              categoryId: "financial-reports",
              sourceUrl: "https://example.com/tsla-q4-2025.pdf",
            },
          },
        ],
        chatMessages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Tesla invested in xAI. [[cite:1]]",
            citations: [
              {
                content: "Tesla entered into an agreement to invest approximately",
                description: "xAI investment",
                chunkType: "text",
                score: 0.95,
                pageCitationPageNumber: 12,
                source: {
                  documentId: "demo-doc-tsla-q4-2025",
                  sourceFileName: "TSLA-Q4-2025-Update.pdf",
                  sectionPath: "TSLA-Q4-2025-Update.pdf/OTHER UPDATES",
                },
              },
            ],
          },
        ],
      }),
    );

    const citationButton = await findStableConnectedElement(() => {
      const desktopChatPanel = within(screen.getByTestId("desktop-chat-panel"));
      return desktopChatPanel.getByRole("button", {
        name: "Open source TSLA-Q4-2025-Update.pdf/p12",
      });
    });
    fireEvent.click(citationButton);

    await waitFor(() => {
      const chunksPanel = screen.getByTestId("desktop-chunks-panel");
      expect(within(chunksPanel).queryByText("Log in to add documents")).toBeNull();
      const topRow = chunksPanel.querySelector<HTMLElement>('[data-index="0"]');
      expect(topRow?.getAttribute("data-chunk-id")).toBe(
        "demo-tsla-q4-2025:chunk_1",
      );
      expect(topRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
  });

  it("focuses guest citations from the mobile chat panel", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = getRequestURL(input);

      if (url.pathname === "/api/sources/demo-source/chunks") {
        return Response.json({
          chunks: [
            {
              chunkId: "demo-source:chunk_1",
              documentId: "doc_1",
              sectionPath: "Demo",
              type: "text",
              content: "Demo cited section",
              sourceTitle: "demo.pdf",
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
        isGuest: true,
        sources: [
          {
            id: "demo-source",
            title: "demo.pdf",
            status: "ready",
            documentId: "doc_1",
          },
        ],
        chatMessages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Demo answer.",
            citations: [
              {
                content: "Demo cited section",
                description: "Demo citation",
                chunkType: "text",
                score: 0.91,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "demo.pdf",
                  sectionPath: "Demo",
                },
              },
            ],
          },
        ],
      }),
    );

    const citationButton = await findStableConnectedElement(() => {
      const mobileChatPanel = within(document.getElementById("panel-chat")!);
      return mobileChatPanel.getByRole("button", {
        name: "Open source demo.pdf",
      });
    });
    fireEvent.click(citationButton);

    await waitFor(() => {
      const topRow = document
        .getElementById("panel-content")!
        .querySelector<HTMLElement>('[data-index="0"]');

      expect(topRow?.getAttribute("data-chunk-id")).toBe("demo-source:chunk_1");
      expect(topRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
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
              content: "The answer uses two sections. [[cite:1]] [[cite:2]]",
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

    await desktopChatPanel.findAllByTestId("citation-chip");
    const getCitationChip = (citationId: string): HTMLButtonElement => {
      const chip = desktopChatPanel
        .getAllByTestId("citation-chip")
        .find((element) => element.getAttribute("data-citation-id") === citationId);
      expect(chip).toBeTruthy();
      return chip as HTMLButtonElement;
    };
    expect(getCitationChip("assistant_1:0")).toBeTruthy();
    expect(getCitationChip("assistant_1:1")).toBeTruthy();
    await user.click(getCitationChip("assistant_1:0"));

    await waitFor(() => {
      expect(
        countFetches(fetch, "/api/sources/source_1/chunks"),
      ).toBeGreaterThan(0);
    });
    await waitFor(() => {
      const topRow = screen
        .getByTestId("desktop-chunks-panel")
        .querySelector<HTMLElement>('[data-index="0"]');

      expect(topRow?.getAttribute("data-chunk-id")).toBe("chunk_1");
      expect(topRow?.getAttribute("data-focused-chunk")).toBe("true");
    });
    expect(countFetches(fetch, "/api/sources/source_1/chunks")).toBe(1);

    await waitFor(() => {
      expect(getCitationChip("assistant_1:1").disabled).toBe(false);
    });
    await user.click(getCitationChip("assistant_1:1"));

    await waitFor(() => {
      const topRow = screen
        .getByTestId("desktop-chunks-panel")
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
        .getByTestId("desktop-chunks-panel")
        .querySelector<HTMLElement>('[data-index="0"]');

      expect(topRow?.getAttribute("data-chunk-id")).toBe("chunk_1");
      expect(topRow?.getAttribute("data-focused-chunk")).toBe("true");
    });

    await user.click(citation);
    await waitFor(() => {
      const topRow = screen
        .getByTestId("desktop-chunks-panel")
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

  it("refreshes the active chat after adding an Official Library source", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://localhost").toString(), init);
      const path = getRequestPath(request);

      if (path === "/api/demo-sources/materialize" && request.method === "POST") {
        return Response.json({
          sources: [
            {
              id: "source_spacex",
              kind: "workspace",
              title: "spacex-s1.pdf",
              status: "ready",
              mimeType: "application/pdf",
              demoSourceId: "demo-spacex-s1",
              documentId: "doc_user_copy",
              chunkCount: 1,
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
              id: "assistant_refreshed",
              role: "assistant",
              content: "Refreshed materialized answer.",
              citations: [
                {
                  content: "User-copy cited section",
                  chunkType: "text",
                  score: 0.91,
                  source: {
                    documentId: "doc_user_copy",
                    sourceFileName: "spacex-s1.pdf",
                    sectionPath: "Overview",
                  },
                },
              ],
            },
          ],
        });
      }

      if (path === "/api/sources/source_spacex/chunks") {
        return Response.json({
          chunks: [
            {
              chunkId: "source_spacex:chunk_1",
              documentId: "doc_user_copy",
              sectionPath: "Overview",
              type: "text",
              content: "User-copy cited section",
              sourceTitle: "spacex-s1.pdf",
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
        officialLibrarySources: [
          {
            librarySourceId: "financial-spacex-s1",
            categoryId: "financial-reports",
            categoryLabel: "Financial Reports",
            title: "spacex-s1.pdf",
            sourceUrl: "https://example.com/spacex-s1.pdf",
            mimeType: "application/pdf",
            status: "ready",
            demoSourceId: "demo-spacex-s1",
            chunkCount: 922,
          },
        ],
        sources: [
          {
            id: "demo-spacex-s1",
            kind: "demo",
            demoSourceId: "demo-spacex-s1",
            title: "spacex-s1.pdf",
            status: "ready",
            mimeType: "application/pdf",
            documentId: "demo-doc-spacex-s1",
            officialLibrary: {
              librarySourceId: "financial-spacex-s1",
              categoryId: "financial-reports",
              sourceUrl: "https://example.com/spacex-s1.pdf",
            },
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
            id: "assistant_seeded",
            role: "assistant",
            content: "Seeded canonical answer.",
            citations: [
              {
                content: "Canonical cited section",
                chunkType: "text",
                score: 0.91,
                source: {
                  documentId: "demo-doc-spacex-s1",
                  sourceFileName: "spacex-s1.pdf",
                  sectionPath: "Overview",
                },
              },
            ],
          },
        ],
      }),
    );

    const desktopSourcesPanel = within(
      screen.getByTestId("desktop-sources-panel"),
    );
    await user.click(desktopSourcesPanel.getByRole("button", { name: "Open library" }));

    const desktopLibraryPanel = within(
      within(screen.getByTestId("desktop-chunks-panel")).getByTestId(
        "official-library-panel",
      ),
    );
    expect(desktopLibraryPanel.getByRole("heading", { name: "Library" }))
      .toBeTruthy();
    await user.click(
      desktopLibraryPanel.getByRole("button", {
        name: "Open Financial Reports",
      }),
    );
    await user.click(
      desktopLibraryPanel.getByRole("button", {
        name: "Add spacex-s1.pdf to sources",
      }),
    );

    const desktopChatPanel = within(screen.getByTestId("desktop-chat-panel"));
    await desktopChatPanel.findByText("Refreshed materialized answer.");
    expect(desktopChatPanel.queryByText("Seeded canonical answer.")).toBeNull();
    const refreshedLibraryPanel = within(
      within(screen.getByTestId("desktop-chunks-panel")).getByTestId(
        "official-library-panel",
      ),
    );
    expect(
      refreshedLibraryPanel.getByRole("heading", { name: "Library" }),
    ).toBeTruthy();
    expect(refreshedLibraryPanel.getByLabelText("spacex-s1.pdf already added"))
      .toBeTruthy();
    expect(
      refreshedLibraryPanel.queryByRole("button", {
        name: "Add spacex-s1.pdf to sources",
      }),
    ).toBeNull();
    expect(countFetches(fetch, "/api/chat/threads/thread_1")).toBe(1);
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

function findStableConnectedElement(
  getElement: () => HTMLElement,
): Promise<HTMLElement> {
  let previousElement: HTMLElement | null = null;

  return waitFor(() => {
    const element = getElement();
    expect(element.isConnected).toBe(true);

    if (element !== previousElement) {
      previousElement = element;
      throw new Error("Element is still settling.");
    }

    return element;
  });
}

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

function createElementRect(width: number): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
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
