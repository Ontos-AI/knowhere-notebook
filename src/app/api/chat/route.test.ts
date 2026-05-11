import { Either } from "effect";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendMessageToThread: vi.fn(),
  ensureDefaultChatThread: vi.fn(),
  findChatThreadInWorkspace: vi.fn(),
  getAuthenticatedWithClient: vi.fn(),
  handleChatTurn: vi.fn(),
  listMessagesForThread: vi.fn(),
  reconcileSourcesForWorkspace: vi.fn(),
}));

vi.mock("@/domains/chat/service", () => ({
  handleChatTurn: mocks.handleChatTurn,
}));

vi.mock("@/domains/workspace/request-context", () => ({
  notebookRequestContext: {
    getAuthenticatedWithClient: mocks.getAuthenticatedWithClient,
  },
}));

vi.mock("@/domains/sources/reconcile", () => ({
  reconcileSourcesForWorkspace: mocks.reconcileSourcesForWorkspace,
}));

vi.mock("@/domains/workspace", () => ({
  appendMessageToThread: mocks.appendMessageToThread,
  ensureDefaultChatThread: mocks.ensureDefaultChatThread,
  findChatThreadInWorkspace: mocks.findChatThreadInWorkspace,
  listMessagesForThread: mocks.listMessagesForThread,
}));

import { POST } from "./route";

describe("POST /api/chat", () => {
  it("reconciles parsing sources before answering a chat turn", async () => {
    const workspace = {
      id: "workspace_1",
      userId: "user_1",
      namespace: "notebook-workspace_1",
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    const client = { retrieval: {} };
    const readySource = {
      id: "source_1",
      status: "ready",
      knowhereDocumentId: "doc_ready",
    };
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    });
    mocks.reconcileSourcesForWorkspace.mockResolvedValue([readySource]);
    mocks.handleChatTurn.mockResolvedValue(
      Either.right({
        threadId: "thread_1",
        messages: [
          { id: "user_1", role: "user", content: "Summarize it" },
          { id: "assistant_1", role: "assistant", content: "Answer" },
        ],
      }),
    );

    const response = await POST(
      new Request("http://localhost:3001/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Summarize it" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getAuthenticatedWithClient).toHaveBeenCalledOnce();
    expect(mocks.reconcileSourcesForWorkspace).toHaveBeenCalledWith(
      workspace,
      client,
    );
    expect(mocks.handleChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [readySource],
      }),
    );
  });
});
