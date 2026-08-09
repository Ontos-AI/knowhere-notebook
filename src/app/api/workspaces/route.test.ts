import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

const mocks = vi.hoisted(() => {
  return {
    activeWorkspaceCookieName: "notebook-ws",
    ensureWorkspaceForNamespace: vi.fn(),
    findByIdAndUserEffect: vi.fn(),
    setActiveEffect: vi.fn(),
    runPromise: vi.fn(),
    getCurrentUser: vi.fn(),
    localizeWorkspaceNamespace: vi.fn(),
  };
});

vi.mock("@/domains/workspace/service", () => ({
  activeWorkspaceCookieName: mocks.activeWorkspaceCookieName,
  workspaceService: {
    ensureWorkspaceForNamespace: mocks.ensureWorkspaceForNamespace,
  },
}));

vi.mock("@/infrastructure/auth/knowhere-api-keys-repository", () => ({
  knowhereApiKeysRepository: {
    findByIdAndUserEffect: mocks.findByIdAndUserEffect,
    setActiveEffect: mocks.setActiveEffect,
    decryptStoredEffect: vi.fn(async () => "sk_test"),
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

vi.mock("@/domains/sources/localize-namespace", () => ({
  localizeWorkspaceNamespace: mocks.localizeWorkspaceNamespace,
}));

import { POST as activateWorkspace } from "./activate/route";
import { POST as createWorkspace } from "./route";

const user = { id: "user_1", email: "ada@example.com", name: "Ada" };
const workspace = {
  id: "ws_1",
  userId: "user_1",
  namespace: "adobe",
  activeKnowhereApiKeyId: null,
  createdAt: new Date(),
};
const key = {
  id: "key_1",
  userId: "user_1",
  label: "domainA",
  keyMask: "sk_te••••st",
  createdAt: new Date(),
};

describe("POST /api/workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.runPromise.mockImplementation(
      (effect: Effect.Effect<unknown, never, never>) =>
        Effect.runPromise(effect),
    );
    mocks.ensureWorkspaceForNamespace.mockResolvedValue(workspace);
    mocks.findByIdAndUserEffect.mockReturnValue(Effect.succeed(key));
    mocks.setActiveEffect.mockReturnValue(Effect.succeed(undefined));
    mocks.localizeWorkspaceNamespace.mockResolvedValue([]);
  });

  it("creates a workspace for a (keyId, namespace) pair, sets the cookie, and localizes", async () => {
    const request = new NextRequest("http://localhost/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ keyId: "key_1", namespace: "adobe" }),
    });

    const response = await createWorkspace(request);
    const body = await response.json();

    expect(mocks.ensureWorkspaceForNamespace).toHaveBeenCalledWith(
      "user_1",
      "adobe",
    );
    expect(response.status).toBe(200);
    expect(body.workspace).toEqual({
      id: "ws_1",
      namespace: "adobe",
    });
    expect(body.sources).toEqual([]);
    expect(response.cookies.get("notebook-ws")?.value).toBe("ws_1");
  });

  it("rejects requests without keyId or namespace", async () => {
    const request = new NextRequest("http://localhost/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ keyId: "key_1" }),
    });

    const response = await createWorkspace(request);

    expect(response.status).toBe(400);
    expect(mocks.ensureWorkspaceForNamespace).not.toHaveBeenCalled();
  });

  it("rejects an unknown key", async () => {
    mocks.findByIdAndUserEffect.mockReturnValue(null);
    const request = new NextRequest("http://localhost/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ keyId: "missing", namespace: "adobe" }),
    });

    const response = await createWorkspace(request);

    expect(response.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ keyId: "key_1", namespace: "adobe" }),
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
