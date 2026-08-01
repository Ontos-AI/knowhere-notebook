// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  trackNotebookAssistantQuestionSubmitted: vi.fn(),
}));

vi.mock("@/lib/posthog", () => ({
  trackNotebookAssistantQuestionSubmitted:
    analyticsMocks.trackNotebookAssistantQuestionSubmitted,
}));

import { workspaceClient } from "@/domains/workspace/client";
import { ChatPanel } from "./chat-panel";

const C = ChatPanel as React.FC<Record<string, unknown>>;

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    createChatDiagram: vi.fn(),
  },
}));

describe("ChatPanel", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    vi.mocked(workspaceClient.createChatDiagram).mockReset();
    analyticsMocks.trackNotebookAssistantQuestionSubmitted.mockReset();
    mockVisibleVirtualViewport();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function expandSources(): void {
    fireEvent.click(screen.getByRole("button", { name: /^Sources/ }));
  }

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

  it("renders assistant evidence as inline source chips", () => {
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

    expandSources();
    expect(
      screen.getByRole("button", {
        name: "Open source syllabus.pdf",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Sources used")).toBeNull();
    expect(screen.queryByText("Citations")).toBeNull();
  });

  it("creates diagrams only through the explicit composer command", async () => {
    const user = userEvent.setup();
    vi.mocked(workspaceClient.createChatDiagram).mockResolvedValue({
      diagram: {
        type: "bar",
        source: "chart-visualization-skills",
        title: "Revenue by Segment",
        axisYTitle: "Revenue",
        data: [
          { category: "Cloud", value: 42 },
          { category: "Ads", value: 28 },
        ],
      },
    });

    render(
      React.createElement(C, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Cloud revenue was 42 and Ads revenue was 28.",
          },
        ],
      }),
    );

    expect(
      screen.queryByRole("button", { name: "Create diagram" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Create diagram for this answer",
      }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Prompts / Chart" }));
    await user.click(
      screen.getByRole("menuitem", {
        name: "Create diagram from latest answer",
      }),
    );

    expect(workspaceClient.createChatDiagram).toHaveBeenCalledWith({
      answer: "Cloud revenue was 42 and Ads revenue was 28.",
    });
    expect(await screen.findByText("Revenue by Segment")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Revenue by Segment" }),
    ).toBeTruthy();
  });

  it("shows a friendly no-diagram state for non-chartable answers", async () => {
    const user = userEvent.setup();
    vi.mocked(workspaceClient.createChatDiagram).mockResolvedValue({
      diagram: {
        type: "none",
        reason:
          "No clear chartable data was found. Ask for a table or numeric comparison first.",
      },
    });

    render(
      React.createElement(C, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "This is a qualitative summary without comparable numbers.",
          },
        ],
      }),
    );

    expect(
      screen.queryByRole("button", {
        name: "Create diagram for this answer",
      }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Prompts / Chart" }));
    await user.click(
      screen.getByRole("menuitem", {
        name: "Create diagram from latest answer",
      }),
    );

    expect(await screen.findByText("No diagram created")).toBeTruthy();
    expect(
      screen.getByText(
        "No clear chartable data was found. Ask for a table or numeric comparison first.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Try diagram again for this answer",
      }),
    ).toBeNull();
  });

  it("treats slash diagram text as a local command instead of a chat message", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    vi.mocked(workspaceClient.createChatDiagram).mockResolvedValue({
      diagram: {
        type: "bar",
        source: "chart-visualization-skills",
        title: "Revenue by Segment",
        data: [
          { category: "Cloud", value: 42 },
          { category: "Ads", value: 28 },
        ],
      },
    });

    render(
      React.createElement(C, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Cloud revenue was 42 and Ads revenue was 28.",
          },
        ],
        onSend,
      }),
    );

    await user.type(
      screen.getByPlaceholderText("Ask a question about your documents…"),
      "/diagram",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).not.toHaveBeenCalled();
    expect(
      analyticsMocks.trackNotebookAssistantQuestionSubmitted,
    ).not.toHaveBeenCalled();
    expect(workspaceClient.createChatDiagram).toHaveBeenCalledWith({
      answer: "Cloud revenue was 42 and Ads revenue was 28.",
    });
  });

  it("tracks normal composer sends as assistant questions", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(
      React.createElement(C, {
        activeThreadId: "thread_1",
        analyticsContext: {
          workspaceId: "workspace_1",
          workspaceNamespace: "demo",
          userId: "user_1",
        },
        selectedSourcesCount: 2,
        sourceCount: 4,
        onSend,
      }),
    );

    await user.type(
      screen.getByPlaceholderText("Ask a question about your documents…"),
      "Summarize revenue",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith("Summarize revenue", {
      rerank: true,
      internalRecallK: 30,
      topK: 8,
    });
    expect(
      analyticsMocks.trackNotebookAssistantQuestionSubmitted,
    ).toHaveBeenCalledWith({
      context: {
        workspaceId: "workspace_1",
        workspaceNamespace: "demo",
        userId: "user_1",
      },
      threadId: "thread_1",
      selectedSourcesCount: 2,
      sourceCountSnapshot: 4,
      messageLength: "Summarize revenue".length,
    });
  });

  it("uses Notebook source titles for generated Knowhere citation filenames", () => {
    const { container } = render(
      React.createElement(C, {
        sourceTitlesByDocumentId: {
          doc_1: "TSLA-Q4-2025-Update.pdf",
        },
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Tesla invested in xAI.",
            citations: [
              {
                chunkType: "text",
                score: 0.9,
                description: "document-CFxAaNTRUliEnWOokpI66xfj7JJkad.pdf",
                source: {
                  documentId: "doc_1",
                  sourceFileName: "document-CFxAaNTRUliEnWOokpI66xfj7JJkad.pdf",
                  sectionPath: "Root",
                },
              },
            ],
          },
        ],
      }),
    );

    expandSources();
    expect(
      screen.getByRole("button", {
        name: "Open source TSLA-Q4-2025-Update.pdf",
      }),
    ).toBeTruthy();
    expect(container.textContent).not.toContain(
      "document-CFxAaNTRUliEnWOokpI66xfj7JJkad.pdf",
    );
  });

  it("deduplicates assistant sources by displayed label while keeping the first click target", async () => {
    const user = userEvent.setup();
    const onCitationClick = vi.fn();
    const firstCitation = {
      chunkType: "text",
      score: 0.9,
      description: "document-wDh6N9QBSgbdAjjweXN8xbw0vTTo5J.pdf",
      source: {
        documentId: "doc_micron_q1",
        sourceFileName: "document-wDh6N9QBSgbdAjjweXN8xbw0vTTo5J.pdf",
        sectionPath: "Root",
      },
    } as const;

    render(
      React.createElement(C, {
        sourceTitlesByDocumentId: {
          doc_micron_q1: "Micron Q1-26 Earnings Deck_R.pdf",
          doc_micron_q2: "Q2 2026 Earnings Deck.pdf",
        },
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Diluted EPS is discussed in the earnings decks.",
            citations: [
              firstCitation,
              {
                chunkType: "text",
                score: 0.86,
                source: {
                  documentId: "doc_micron_q1",
                  sourceFileName: "Micron Q1-26 Earnings Deck_R.pdf",
                  sectionPath: "Root",
                },
              },
              {
                chunkType: "text",
                score: 0.82,
                source: {
                  documentId: "doc_micron_q2",
                  sourceFileName: "Q2 2026 Earnings Deck.pdf",
                  sectionPath: "Mark Murphy / Non-GAAP operating results",
                },
              },
            ],
          },
        ],
        onCitationClick,
      }),
    );

    expandSources();
    const duplicatedSourceLinks = screen.getAllByRole("button", {
      name: "Open source Micron Q1-26 Earnings Deck_R.pdf",
    });

    expect(duplicatedSourceLinks).toHaveLength(1);
    expect(
      screen.getAllByRole("button", {
        name: "Open source Q2 2026 Earnings Deck.pdf",
      }),
    ).toHaveLength(1);

    await user.click(duplicatedSourceLinks[0]);

    expect(onCitationClick).toHaveBeenCalledWith(firstCitation, "assistant_1:0");
  });

  it("keeps separate source links when different documents share one displayed label", async () => {
    const user = userEvent.setup();
    const onCitationClick = vi.fn();
    const firstCitation = {
      chunkType: "text",
      score: 0.9,
      source: {
        documentId: "doc_first",
        sourceFileName: "report.pdf",
        sectionPath: "Root",
      },
    } as const;
    const secondCitation = {
      chunkType: "text",
      score: 0.88,
      source: {
        documentId: "doc_second",
        sourceFileName: "report.pdf",
        sectionPath: "Root",
      },
    } as const;

    render(
      React.createElement(C, {
        sourceTitlesByDocumentId: {
          doc_first: "report.pdf",
          doc_second: "report.pdf",
        },
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "Both reports are relevant.",
            citations: [firstCitation, secondCitation],
          },
        ],
        onCitationClick,
      }),
    );

    expandSources();
    const duplicatedLabelLinks = screen.getAllByRole("button", {
      name: "Open source report.pdf",
    });

    expect(duplicatedLabelLinks).toHaveLength(2);

    await user.click(duplicatedLabelLinks[1]);

    expect(onCitationClick).toHaveBeenCalledWith(
      secondCitation,
      "assistant_1:1",
    );
  });

  it("renders source buttons as text-only chips with pending state", async () => {
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

    expandSources();
    const citationButton = screen.getByRole("button", {
      name: "Open source syllabus.pdf",
    });

    expect(citationButton.getAttribute("aria-busy")).toBe("true");
    expect(citationButton.textContent).toBe("syllabus.pdf");
    expect(citationButton.className).toContain("rounded-md");
    expect(citationButton.className).toContain("h-8");
    expect(citationButton.className).toContain("max-w-[250px]");
    expect(citationButton.className).toContain("font-mono");
    expect(citationButton.className).toContain("text-primary");
    expect(citationButton.className).toContain("bg-primary/10");
    expect(citationButton.className).toContain("border-primary/20");
    expect(citationButton.className).toContain("hover:border-primary/35");
    expect(citationButton.className).toContain("hover:bg-primary/15");
    expect(citationButton.className).toContain("dark:bg-[#5c606b]");
    expect(citationButton.className).toContain("dark:text-[#cfd3dc]");
    expect(citationButton.className).toContain(
      "hover:shadow-[0_0_0_2px_rgba(37,99,235,0.12)]",
    );
    expect(citationButton.className).not.toContain("border-border");
    expect(citationButton.className).not.toContain("bg-background/80");
    expect(citationButton.className).not.toContain("underline");

    await user.click(citationButton);
    expect(onCitationClick).not.toHaveBeenCalled();
  });

  it("keeps long bottom source labels constrained", () => {
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

    expandSources();
    const sourceLink = screen.getByRole("button", {
      name: /Open source TSLA-Q4-2025-UPDATE\.PDF/,
    });

    expect(sourceLink.className).toContain("max-w-[250px]");
    expect(sourceLink.className).toContain("rounded-md");
    expect(sourceLink.className).not.toContain("underline");
    expect(
      within(sourceLink).getByText(
        /TSLA-Q4-2025-UPDATE\.PDF/u,
      ).className,
    ).toContain("truncate");
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

  it("shows assistant thinking progress while a response is pending", () => {
    render(
      React.createElement(C, {
        isSending: true,
        messages: [
          {
            id: "user_1",
            role: "user",
            content: "What changed in Q4?",
          },
        ],
      }),
    );

    expect(screen.getByRole("status", { name: "Thinking" })).toBeTruthy();
    expect(screen.getByText("Thinking")).toBeTruthy();
  });

  it("shows a visible send button label for mobile chat input", async () => {
    const user = userEvent.setup();

    render(
      React.createElement(C, {
        onSend: vi.fn(),
      }),
    );

    await user.type(
      screen.getByPlaceholderText("Ask a question about your documents…"),
      "Summarize this document",
    );

    const sendButton = screen.getByRole("button", { name: "Send message" });

    expect(within(sendButton).getByText("Send")).toBeTruthy();
    expect(sendButton.className).not.toContain("absolute");
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
      screen.queryByPlaceholderText("Add a ready source to start asking questions."),
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
