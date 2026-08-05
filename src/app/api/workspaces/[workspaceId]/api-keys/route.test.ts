import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

const mocks = vi.hoisted(() => {
  return {
    findByIdAndUserIdEffect: vi.fn(),
    runPromise: vi.fn(),
    getCurrentUser: vi.fn(),
    listByWorkspaceEffect: vi.fn(),
    createEffect: vi.fn(),
    findByWorkspaceAndLabelEffect: vi.fn(),
    setActiveEffect: vi.fn(),
    findByIdAndWorkspaceEffect: vi.fn(),
    softDeleteEffect: vi.fn(),
  };
});

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

vi.mock("@/infrastructure/auth/knowhere-api-keys-repository", () => ({
  knowhereApiKeysRepository: {
    listByWorkspaceEffect: mocks.listByWorkspaceEffect,
    createEffect: mocks.createEffect,
    findByWorkspaceAndLabelEffect: mocks.findByWorkspaceAndLabelEffect,
    setActiveEffect: mocks.setActiveEffect,
    findByIdAndWorkspaceEffect: mocks.findByIdAndWorkspaceEffect,
    softDeleteEffect: mocks.softDeleteEffect,
  },
}));

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { GET as listKeys, POST as createKey } from "./route";
import { PATCH as setActive, DELETE as deleteKey } from "./[apiKeyId]/route";

const user = { id: "user_1", email: "ada@example.com", name: "Ada" };
const workspace = {
  id: "ws_1",
  userId: "user_1",
  knowhereKeyLabel: null,
  activeKnowhereApiKeyId: null,
  namespace: "quarterly",
  createdAt: new Date(),
};

const storedKey = {
  id: "key_1",
  workspaceId: "ws_1",
  label: "domainA",
  createdAt: new Date("2026-08-01T00:00:00Z"),
};

function runEffect(effect: unknown): Promise<unknown> {
  return Effect.runPromise(effect as Effect.Effect<unknown, never, never>);
}

describe("workspace API keys routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.runPromise.mockImplementation(runEffect);
    mocks.findByIdAndUserIdEffect.mockReturnValue(Effect.succeed(workspace));
  });

  describe("GET", () => {
    it("lists keys with their active flag", async () => {
      mocks.listByWorkspaceEffect.mockReturnValue(
        Effect.succeed([
          { ...storedKey },
          { ...storedKey, id: "key_2", label: "domainB" },
        ]),
      );
      const params = { params: Promise.resolve({ workspaceId: "ws_1" }) };

      const response = await listKeys(new NextRequest("http://localhost"), params);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.keys).toEqual([
        {
          id: "key_1",
          label: "domainA",
          createdAt: "2026-08-01T00:00:00.000Z",
          isActive: false,
        },
        {
          id: "key_2",
          label: "domainB",
          createdAt: "2026-08-01T00:00:00.000Z",
          isActive: false,
        },
      ]);
    });

    it("returns 404 for a workspace that is not the user's", async () => {
      mocks.findByIdAndUserIdEffect.mockReturnValue(Effect.succeed(null));
      const params = { params: Promise.resolve({ workspaceId: "ws_other" }) };

      const response = await listKeys(new NextRequest("http://localhost"), params);

      expect(response.status).toBe(404);
    });
  });

  describe("POST", () => {
    it("creates a key and sets it active", async () => {
      mocks.findByWorkspaceAndLabelEffect.mockReturnValue(Effect.succeed(null));
      mocks.createEffect.mockReturnValue(
        Effect.succeed({
          id: "key_new",
          workspaceId: "ws_1",
          label: "domainA",
          cipherBlob: "encrypted",
          cipherNonce: "nonce",
          createdAt: new Date("2026-08-01T00:00:00Z"),
          deletedAt: null,
        }),
      );
      mocks.setActiveEffect.mockReturnValue(Effect.succeed(undefined));
      const request = new NextRequest("http://localhost/api-keys", {
        method: "POST",
        body: JSON.stringify({ label: "domainA", apiKey: "sk_test" }),
      });
      const params = { params: Promise.resolve({ workspaceId: "ws_1" }) };

      const response = await createKey(request, params);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mocks.createEffect).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        label: "domainA",
        apiKey: "sk_test",
      });
      expect(mocks.setActiveEffect).toHaveBeenCalledWith("ws_1", "key_new");
      expect(body.key.isActive).toBe(true);
    });

    it("rejects a duplicate label with 409", async () => {
      mocks.findByWorkspaceAndLabelEffect.mockReturnValue(
        Effect.succeed({ ...storedKey }),
      );
      const request = new NextRequest("http://localhost/api-keys", {
        method: "POST",
        body: JSON.stringify({ label: "domainA", apiKey: "sk_test" }),
      });
      const params = { params: Promise.resolve({ workspaceId: "ws_1" }) };

      const response = await createKey(request, params);

      expect(response.status).toBe(409);
    });
  });

  describe("PATCH / DELETE", () => {
    it("sets a key active", async () => {
      mocks.findByIdAndWorkspaceEffect.mockReturnValue(
        Effect.succeed({ ...storedKey }),
      );
      mocks.setActiveEffect.mockReturnValue(Effect.succeed(undefined));
      const request = new NextRequest("http://localhost/api-keys/key_1", {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      });
      const params = {
        params: Promise.resolve({ workspaceId: "ws_1", apiKeyId: "key_1" }),
      };

      const response = await setActive(request, params);

      expect(response.status).toBe(200);
      expect(mocks.setActiveEffect).toHaveBeenCalledWith("ws_1", "key_1");
    });

    it("soft-deletes a key and clears active when it was the active one", async () => {
      mocks.findByIdAndWorkspaceEffect.mockReturnValue(
        Effect.succeed({ ...storedKey }),
      );
      mocks.softDeleteEffect.mockReturnValue(Effect.succeed(undefined));
      mocks.setActiveEffect.mockReturnValue(Effect.succeed(undefined));
      mocks.findByIdAndUserIdEffect.mockReturnValue(
        Effect.succeed({ ...workspace, activeKnowhereApiKeyId: "key_1" }),
      );
      const params = {
        params: Promise.resolve({ workspaceId: "ws_1", apiKeyId: "key_1" }),
      };

      const response = await deleteKey(
        new NextRequest("http://localhost/api-keys/key_1", { method: "DELETE" }),
        params,
      );

      expect(response.status).toBe(200);
      expect(mocks.softDeleteEffect).toHaveBeenCalledWith("key_1", "ws_1");
      expect(mocks.setActiveEffect).toHaveBeenCalledWith("ws_1", null);
    });
  });
});
