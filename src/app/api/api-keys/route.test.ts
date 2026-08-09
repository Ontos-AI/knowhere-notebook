import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

const mocks = vi.hoisted(() => {
  return {
    getCurrentUser: vi.fn(),
    runPromise: vi.fn(),
    listByUserEffect: vi.fn(),
    createForUserEffect: vi.fn(),
    findByUserIdAndNamespaceEffect: vi.fn(),
    insertForUserNamespaceEffect: vi.fn(),
    setActiveEffect: vi.fn(),
    validateKnowhereApiKey: vi.fn(),
    findByIdAndUserEffect: vi.fn(),
    softDeleteEffect: vi.fn(),
    clearActiveForKeyEffect: vi.fn(),
  };
});

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/domains/workspace/database-runtime", () => ({
  databaseRuntime: {
    runPromise: mocks.runPromise,
  },
}));

vi.mock("@/domains/workspace/repository", () => ({
  workspaceRepository: {
    findByUserIdAndNamespaceEffect: mocks.findByUserIdAndNamespaceEffect,
    insertForUserNamespaceEffect: mocks.insertForUserNamespaceEffect,
  },
}));

vi.mock("@/infrastructure/auth/knowhere-api-keys-repository", () => ({
  knowhereApiKeysRepository: {
    listByUserEffect: mocks.listByUserEffect,
    createForUserEffect: mocks.createForUserEffect,
    findByUserIdAndNamespaceEffect: mocks.findByUserIdAndNamespaceEffect,
    insertForUserNamespaceEffect: mocks.insertForUserNamespaceEffect,
    setActiveEffect: mocks.setActiveEffect,
    findByIdAndUserEffect: mocks.findByIdAndUserEffect,
    softDeleteEffect: mocks.softDeleteEffect,
    clearActiveForKeyEffect: mocks.clearActiveForKeyEffect,
  },
}));

vi.mock("@/integrations/knowhere", () => ({
  validateKnowhereApiKey: mocks.validateKnowhereApiKey,
}));

import { GET as listKeys, POST as addKey } from "./route";
import { DELETE as deleteKey } from "./[apiKeyId]/route";

const user = { id: "user_1", email: "ada@example.com", name: "Ada" };
const storedKey = {
  id: "key_1",
  userId: "user_1",
  label: "domainA",
  keyMask: "sk_te••••st",
  createdAt: new Date("2026-08-01T00:00:00Z"),
};
const homeWorkspace = {
  id: "ws_default",
  userId: "user_1",
  namespace: "default",
  activeKnowhereApiKeyId: null,
  createdAt: new Date(),
};

function runEffect(effect: unknown): Promise<unknown> {
  return Effect.runPromise(effect as Effect.Effect<unknown, never, never>);
}

describe("api-keys routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.runPromise.mockImplementation(runEffect);
    mocks.listByUserEffect.mockReturnValue(Effect.succeed([]));
    mocks.findByUserIdAndNamespaceEffect.mockReturnValue(
      Effect.succeed(homeWorkspace),
    );
    mocks.setActiveEffect.mockReturnValue(Effect.succeed(undefined));
    mocks.validateKnowhereApiKey.mockResolvedValue(true);
  });

  describe("GET /api/api-keys", () => {
    it("lists the user's keys with masks", async () => {
      mocks.listByUserEffect.mockReturnValue(Effect.succeed([storedKey]));

      const response = await listKeys();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.keys).toEqual([
        {
          id: "key_1",
          label: "domainA",
          mask: "sk_te••••st",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ]);
    });

    it("rejects unauthenticated requests", async () => {
      mocks.getCurrentUser.mockResolvedValue(null);

      const response = await listKeys();

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/api-keys", () => {
    it("rejects an invalid key with 422 without storing anything", async () => {
      mocks.validateKnowhereApiKey.mockResolvedValue(false);
      const request = new NextRequest("http://localhost/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ label: "domainA", apiKey: "sk_bad" }),
      });

      const response = await addKey(request);

      expect(response.status).toBe(422);
      expect(mocks.createForUserEffect).not.toHaveBeenCalled();
      expect(mocks.setActiveEffect).not.toHaveBeenCalled();
    });

    it("stores a valid key and activates the home workspace", async () => {
      mocks.createForUserEffect.mockReturnValue(
        Effect.succeed({
          id: "key_new",
          userId: "user_1",
          label: "domainA",
          keyMask: "sk_te••••st",
          cipherBlob: "x",
          cipherNonce: "y",
          createdAt: new Date("2026-08-01T00:00:00Z"),
          deletedAt: null,
        }),
      );
      const request = new NextRequest("http://localhost/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ label: "domainA", apiKey: "sk_valid" }),
      });

      const response = await addKey(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mocks.validateKnowhereApiKey).toHaveBeenCalledWith("sk_valid");
      expect(mocks.createForUserEffect).toHaveBeenCalledWith({
        userId: "user_1",
        label: "domainA",
        apiKey: "sk_valid",
      });
      expect(mocks.setActiveEffect).toHaveBeenCalledWith("ws_default", "key_new");
      expect(response.cookies.get("notebook-ws")?.value).toBe("ws_default");
      expect(body.workspace).toEqual({
        id: "ws_default",
        namespace: "default",
      });
    });

    it("rejects a duplicate label with 409", async () => {
      mocks.listByUserEffect.mockReturnValue(Effect.succeed([storedKey]));
      const request = new NextRequest("http://localhost/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ label: "domainA", apiKey: "sk_valid" }),
      });

      const response = await addKey(request);

      expect(response.status).toBe(409);
      expect(mocks.validateKnowhereApiKey).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/api-keys/[apiKeyId]", () => {
    it("soft-deletes a key and clears workspace pointers", async () => {
      mocks.findByIdAndUserEffect.mockReturnValue(Effect.succeed(storedKey));
      mocks.softDeleteEffect.mockReturnValue(Effect.succeed(undefined));
      mocks.clearActiveForKeyEffect.mockReturnValue(Effect.succeed(undefined));

      const response = await deleteKey(
        new NextRequest("http://localhost/api/api-keys/key_1", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ apiKeyId: "key_1" }) },
      );

      expect(response.status).toBe(200);
      expect(mocks.softDeleteEffect).toHaveBeenCalledWith("key_1", "user_1");
      expect(mocks.clearActiveForKeyEffect).toHaveBeenCalledWith("key_1", "user_1");
    });

    it("returns 404 for a key the user does not own", async () => {
      mocks.findByIdAndUserEffect.mockReturnValue(Effect.succeed(null));

      const response = await deleteKey(
        new NextRequest("http://localhost/api/api-keys/key_x", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ apiKeyId: "key_x" }) },
      );

      expect(response.status).toBe(404);
    });
  });
});
