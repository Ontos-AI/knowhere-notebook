// @vitest-environment jsdom
import React, { type ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatThreadView } from "@/domains/chat/types";
import { useChatPanelWorkflow } from "./chat-panel-workflow";

const threads: readonly ChatThreadView[] = [
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
];

describe("useChatPanelWorkflow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts a new chat and closes chat history", () => {
    const onNewChat = vi.fn();

    render(
      React.createElement(ChatPanelWorkflowHarness, {
        isCreatingThread: false,
        onNewChat,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "open-history" }));
    expect(screen.getByTestId("is-history-open").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "new-chat" }));

    expect(onNewChat).toHaveBeenCalledOnce();
    expect(screen.getByTestId("is-history-open").textContent).toBe("false");
  });

  it("does not create a new chat while creation is pending", () => {
    const onNewChat = vi.fn();

    render(
      React.createElement(ChatPanelWorkflowHarness, {
        isCreatingThread: true,
        onNewChat,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "open-history" }));
    fireEvent.click(screen.getByRole("button", { name: "new-chat" }));

    expect(onNewChat).not.toHaveBeenCalled();
    expect(screen.getByTestId("is-history-open").textContent).toBe("true");
  });

  it("confirms thread archive and clears the confirmation", () => {
    const onThreadArchive = vi.fn();

    render(
      React.createElement(ChatPanelWorkflowHarness, {
        onThreadArchive,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "confirm-thread-2" }));
    expect(screen.getByTestId("confirm-thread-title").textContent).toBe(
      "Margin question",
    );

    fireEvent.click(screen.getByRole("button", { name: "archive-confirmed" }));

    expect(onThreadArchive).toHaveBeenCalledWith("thread_2");
    expect(screen.getByTestId("confirm-thread-title").textContent).toBe("");
  });
});

function ChatPanelWorkflowHarness({
  isCreatingThread = false,
  onNewChat,
  onThreadArchive,
}: {
  readonly isCreatingThread?: boolean;
  readonly onNewChat?: () => void;
  readonly onThreadArchive?: (threadId: string) => void;
}): ReactElement {
  const {
    confirmThread,
    isHistoryOpen,
    handleArchiveConfirm,
    handleHistoryOpenChange,
    handleNewChat,
    handleThreadArchiveRequest,
  } = useChatPanelWorkflow({
    isCreatingThread,
    onNewChat,
    onThreadArchive,
    threads,
  });

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => handleHistoryOpenChange(true),
      },
      "open-history",
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: handleNewChat,
      },
      "new-chat",
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => handleThreadArchiveRequest("thread_2"),
      },
      "confirm-thread-2",
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: handleArchiveConfirm,
      },
      "archive-confirmed",
    ),
    React.createElement(
      "div",
      { "data-testid": "is-history-open" },
      String(isHistoryOpen),
    ),
    React.createElement(
      "div",
      { "data-testid": "confirm-thread-title" },
      confirmThread?.title ?? "",
    ),
  );
}
