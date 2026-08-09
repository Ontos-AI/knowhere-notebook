import { describe, expect, it, vi } from "vitest";

import { chatTurnPersistence } from "./chat-turn-persistence";
import type { ChatMessage, ChatThread } from "@/infrastructure/db/schema";

describe("chatTurnPersistence", () => {
  it("adapts Chat Thread persistence to the Chat Turn repository interface", async () => {
    const thread = makeThread();
    const firstMessage = makeMessage("message_1");
    const service = {
      appendMessage: vi.fn(async () => firstMessage),
      ensureDefault: vi.fn(async () => thread),
      findInWorkspace: vi.fn(async () => thread),
      listMessages: vi.fn(async (workspaceId: string, threadId: string) => {
        expect([workspaceId, threadId]).toEqual(["workspace_1", "thread_1"]);
        return [firstMessage];
      }),
    };

    const repository = chatTurnPersistence.createRepository(service);
    const messages = await repository.listMessagesForThread(
      "workspace_1",
      "thread_1",
    );

    expect(messages).toEqual([firstMessage]);
    expect(messages).not.toBe(await service.listMessages("workspace_1", "thread_1"));
    await repository.appendMessageToThread("workspace_1", {
      threadId: "thread_1",
      role: "assistant",
      content: "Answer",
      citations: [],
    });

    expect(service.ensureDefault).not.toHaveBeenCalled();
    expect(service.appendMessage).toHaveBeenCalledWith("workspace_1", {
      threadId: "thread_1",
      role: "assistant",
      content: "Answer",
      citations: [],
    });
  });
});

function makeThread(): ChatThread {
  return {
    id: "thread_1",
    workspaceId: "workspace_1",
    title: "Revenue",
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
  };
}

function makeMessage(id: string): ChatMessage {
  return {
    id,
    threadId: "thread_1",
    role: "user",
    content: "Question",
    citations: null,
    artifacts: null,
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
  };
}
