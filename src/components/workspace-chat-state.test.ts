import { describe, expect, it } from "vitest";

import { workspaceChatState } from "./workspace-chat-state";

import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types";

describe("workspaceChatState", () => {
  it("selects a cached chat thread without entering loading state", () => {
    const messages: ChatMessageView[] = [
      {
        id: "message_1",
        role: "assistant",
        content: "Cached answer",
      },
    ];

    const selected = workspaceChatState.selectThread({
      current: {
        threadId: "thread_1",
        messages: [],
        isSending: false,
        isLoading: false,
        error: "Previous error",
        pendingStatusText: null,
      },
      threadId: "thread_2",
      loadedMessages: messages,
    });

    expect(selected).toEqual({
      threadId: "thread_2",
      messages,
      isSending: false,
      isLoading: false,
      error: null,
      pendingStatusText: null,
    });
  });

  it("rolls back an optimistic user message when sending fails", () => {
    const initialMessages: ChatMessageView[] = [
      {
        id: "message_1",
        role: "assistant",
        content: "Existing answer",
      },
    ];
    const optimistic = workspaceChatState.addOptimisticUserMessage(
      {
        threadId: null,
        messages: initialMessages,
        isSending: false,
        isLoading: false,
        error: null,
        pendingStatusText: null,
      },
      {
        id: "pending-1",
        content: "Question",
      },
    );

    expect(optimistic.pendingStatusText).toBe("Searching sources…");

    const failed = workspaceChatState.failSend(optimistic, "pending-1");

    expect(failed).toEqual({
      threadId: null,
      messages: initialMessages,
      isSending: false,
      isLoading: false,
      error: "The assistant could not answer right now.",
      pendingStatusText: null,
    });
  });

  it("updates existing new-chat titles after a successful send", () => {
    const threads: readonly ChatThreadView[] = [
      {
        id: "thread_1",
        title: "New chat",
        createdAt: "2026-05-10T01:00:00.000Z",
        updatedAt: "2026-05-10T01:00:00.000Z",
      },
    ];

    const updated = workspaceChatState.upsertThreadAfterSend(
      threads,
      "thread_1",
      "What changed in the contract?",
    );

    expect(updated[0]).toEqual(
      expect.objectContaining({
        id: "thread_1",
        title: "What changed in the contract?",
      }),
    );
    expect(updated).toHaveLength(1);
  });
});
