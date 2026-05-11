import { Either } from "effect";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendMessageToThread: vi.fn(),
  ensureApiKeyForWorkspace: vi.fn(),
  ensureDefaultChatThread: vi.fn(),
  ensureWorkspace: vi.fn(),
  findChatThreadInWorkspace: vi.fn(),
  handleChatTurn: vi.fn(),
  listMessagesForThread: vi.fn(),
  listSourcesForWorkspace: vi.fn(),
  makeKnowhereClient: vi.fn(),
  reconcileSourcesForWorkspace: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ cookie: "session=abc" })),
}));

vi.mock("@/lib/api-key-service", () => ({
  ensureApiKeyForWorkspace: mocks.ensureApiKeyForWorkspace,
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/chat-service", () => ({
  handleChatTurn: mocks.handleChatTurn,
}));

vi.mock("@/lib/knowhere", () => ({
  makeKnowhereClient: mocks.makeKnowhereClient,
}));

vi.mock("@/lib/source-reconcile", () => ({
  reconcileSourcesForWorkspace: mocks.reconcileSourcesForWorkspace,
}));

vi.mock("@/lib/workspace", () => ({
  appendMessageToThread: mocks.appendMessageToThread,
  ensureDefaultChatThread: mocks.ensureDefaultChatThread,
  ensureWorkspace: mocks.ensureWorkspace,
  findChatThreadInWorkspace: mocks.findChatThreadInWorkspace,
  listMessagesForThread: mocks.listMessagesForThread,
  listSourcesForWorkspace: mocks.listSourcesForWorkspace,
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
    const parsingSource = {
      id: "source_1",
      status: "parsing",
      knowhereDocumentId: null,
    };
    const readySource = {
      id: "source_1",
      status: "ready",
      knowhereDocumentId: "doc_ready",
    };
    mocks.requireUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue(workspace);
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123");
    mocks.makeKnowhereClient.mockReturnValue(client);
    mocks.listSourcesForWorkspace.mockResolvedValue([parsingSource]);
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
