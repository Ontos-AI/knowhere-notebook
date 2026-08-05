import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    activeWorkspaceCookieName: "notebook-ws",
    ensureWorkspaceForLabelAndNamespace: vi.fn(),
    findByIdAndUserIdEffect: vi.fn(),
    runPromise: vi.fn(),
    getCurrentUser: vi.fn(),
  };
});

vi.mock("@/domains/workspace/service", () => ({
  activeWorkspaceCookieName: mocks.activeWorkspaceCookieName,
  workspaceService: {
    ensureWorkspaceForLabelAndNamespace: mocks.ensureWorkspaceForLabelAndNamespace,
  },
}));

vi.mock("@/domains/workspace/repository", () => ({
  workspaceRepository: {
    findByIdAndUserIdEffect: mocks.findByIdAndUserIdEffect,
  },
}));

vi.mock("@/domains/workspace/database-runtime", () => ({
  databaseRuntime: {
    runPromise: mocks.runPromise,
  },
}));

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { POST as activateWorkspace } from "./activate/route";
import { POST as createWorkspace } from "./route";

const user = { id: "user_1", email: "ada@example.com", name: "Ada" };
const workspace = {
  id: "ws_1",
  userId: "user_1",
  knowhereKeyLabel: "domainA",
  namespace: "quarterly",
  createdAt: new Date(),
};

describe("POST /api/workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(user);
  });

  it("creates a workspace for a (keyLabel, namespace) pair and sets the cookie", async () => {
    mocks.ensureWorkspaceForLabelAndNamespace.mockResolvedValue(workspace);
    const request = new NextRequest("http://localhost/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ keyLabel: "domainA", namespace: "quarterly" }),
    });

    const response = await createWorkspace(request);
    const body = await response.json();

    expect(mocks.ensureWorkspaceForLabelAndNamespace).toHaveBeenCalledWith(
      "user_1",
      "domainA",
      "quarterly",
    );
    expect(response.status).toBe(200);
    expect(body.workspace).toEqual({
      id: "ws_1",
      namespace: "quarterly",
      keyLabel: "domainA",
    });
    expect(response.cookies.get("notebook-ws")?.value).toBe("ws_1");
  });

  it("rejects requests without keyLabel or namespace", async () => {
    const request = new NextRequest("http://localhost/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ keyLabel: "domainA" }),
    });

    const response = await createWorkspace(request);

    expect(response.status).toBe(400);
    expect(mocks.ensureWorkspaceForLabelAndNamespace).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ keyLabel: "domainA", namespace: "quarterly" }),
    });

    const response = await createWorkspace(request);

    expect(response.status).toBe(400);
  });
});

describe("POST /api/workspaces/activate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.runPromise.mockResolvedValue(workspace);
  });

  it("activates an owned workspace and sets the cookie", async () => {
    const request = new NextRequest("http://localhost/api/workspaces/activate", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws_1" }),
    });

    const response = await activateWorkspace(request);

    expect(mocks.runPromise).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.cookies.get("notebook-ws")?.value).toBe("ws_1");
  });

  it("rejects a workspace that does not belong to the user", async () => {
    mocks.runPromise.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/workspaces/activate", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws_other" }),
    });

    const response = await activateWorkspace(request);

    expect(response.status).toBe(404);
  });

  it("rejects requests without workspaceId", async () => {
    const request = new NextRequest("http://localhost/api/workspaces/activate", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await activateWorkspace(request);

    expect(response.status).toBe(400);
  });
});
