import React from "react";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureApiKeyForWorkspace: vi.fn(),
  ensureDemoWorkspaceContent: vi.fn(),
  ensureWorkspace: vi.fn(),
  getCurrentUser: vi.fn(),
  listChatThreadsForWorkspace: vi.fn(),
  listMessagesForThread: vi.fn(),
  listSourcesForWorkspace: vi.fn(),
  makeKnowhereClient: vi.fn(),
  sourceViewOptionsBySourceId: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ cookie: "session=abc" })),
}));

vi.mock("@/integrations/dashboard/api-key-service", () => ({
  ensureApiKeyForWorkspace: mocks.ensureApiKeyForWorkspace,
}));

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClient: mocks.makeKnowhereClient,
}));

vi.mock("@/domains/sources/counts", () => ({
  sourceViewOptionsBySourceId: mocks.sourceViewOptionsBySourceId,
}));

vi.mock("@/domains/workspace/service", () => ({
  workspaceService: {
    ensureDemoWorkspaceContent: mocks.ensureDemoWorkspaceContent,
    ensureWorkspace: mocks.ensureWorkspace,
  },
}));

vi.mock("@/domains/sources/service", () => ({
  sourceService: {
    listForWorkspace: mocks.listSourcesForWorkspace,
  },
}));

vi.mock("@/domains/chat/thread-service", () => ({
  chatThreadService: {
    listForWorkspace: mocks.listChatThreadsForWorkspace,
    listMessages: mocks.listMessagesForThread,
  },
}));

import Home from "./page";

describe("Home", () => {
  it("uploads bundled demo content into the logged-in workspace before rendering", async () => {
    const client = {};
    mocks.getCurrentUser.mockResolvedValue({
      id: "user_1",
      name: "Ada",
      email: "ada@example.com",
    });
    mocks.ensureWorkspace.mockResolvedValue({
      id: "workspace_1",
      namespace: "notebook-workspace_1",
    });
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123");
    mocks.makeKnowhereClient.mockReturnValue(client);
    mocks.listSourcesForWorkspace.mockResolvedValue([]);
    mocks.listChatThreadsForWorkspace.mockResolvedValue([]);
    mocks.sourceViewOptionsBySourceId.mockReturnValue(Effect.succeed(new Map()));

    const element = await Home();

    expect(React.isValidElement(element)).toBe(true);
    expect(mocks.ensureDemoWorkspaceContent).toHaveBeenCalledWith(
      {
        id: "workspace_1",
        namespace: "notebook-workspace_1",
      },
      client,
    );
    expect(
      mocks.ensureDemoWorkspaceContent.mock.invocationCallOrder[0],
    ).toBeGreaterThan(mocks.makeKnowhereClient.mock.invocationCallOrder[0]);
    expect(
      mocks.ensureDemoWorkspaceContent.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.listSourcesForWorkspace.mock.invocationCallOrder[0]);
  });
});
