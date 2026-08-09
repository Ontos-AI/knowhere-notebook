import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"

const mocks = vi.hoisted(() => ({
  findByIdEffect: vi.fn(),
  runPromise: vi.fn(),
  getDefaultKnowhereKey: vi.fn(),
  getActiveForWorkspaceEffect: vi.fn(),
  firstForUserEffect: vi.fn(),
  decryptStoredEffect: vi.fn(),
}))

vi.mock("@/domains/workspace/repository", () => ({
  workspaceRepository: {
    findByIdEffect: mocks.findByIdEffect,
  },
}))

vi.mock("@/domains/workspace/database-runtime", () => ({
  databaseRuntime: {
    runPromise: mocks.runPromise,
  },
}))

vi.mock("@/infrastructure/auth/knowhere-api-keys-repository", () => ({
  knowhereApiKeysRepository: {
    getActiveForWorkspaceEffect: mocks.getActiveForWorkspaceEffect,
    firstForUserEffect: mocks.firstForUserEffect,
    decryptStoredEffect: mocks.decryptStoredEffect,
  },
}))

vi.mock("@/integrations/knowhere-keys", () => ({
  getDefaultKnowhereKey: mocks.getDefaultKnowhereKey,
}))

import { ensureApiKeyForWorkspace, isAuthError } from "./knowhere-credentials"

describe("ensureApiKeyForWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runPromise.mockImplementation((effect: Effect.Effect<unknown, never, never>) =>
      Effect.runPromise(effect),
    )
    mocks.getDefaultKnowhereKey.mockResolvedValue(null)
    mocks.getActiveForWorkspaceEffect.mockReturnValue(Effect.succeed(null))
    mocks.firstForUserEffect.mockReturnValue(Effect.succeed(null))
    mocks.decryptStoredEffect.mockReturnValue(
      Effect.succeed("sk_decrypted_db_key"),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("decrypts the workspace's active DB key when one is set", async () => {
    mocks.findByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "workspace_db",
        userId: "user_1",
        activeKnowhereApiKeyId: "key_1",
        namespace: "adobe",
        createdAt: new Date(),
      }),
    )
    mocks.getActiveForWorkspaceEffect.mockReturnValue(
      Effect.succeed({
        id: "key_1",
        userId: "user_1",
        label: "domainA",
        keyMask: "sk_te••••st",
        createdAt: new Date(),
      }),
    )

    const apiKey = await ensureApiKeyForWorkspace("workspace_db")

    expect(apiKey).toBe("sk_decrypted_db_key")
    expect(mocks.decryptStoredEffect).toHaveBeenCalled()
  })

  it("falls back to the user's first key when no active key is set", async () => {
    mocks.findByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "workspace_1",
        userId: "user_1",
        activeKnowhereApiKeyId: null,
        namespace: "adobe",
        createdAt: new Date(),
      }),
    )
    mocks.getActiveForWorkspaceEffect.mockReturnValue(Effect.succeed(null))
    mocks.firstForUserEffect.mockReturnValue(
      Effect.succeed({
        id: "key_9",
        userId: "user_1",
        label: "domainA",
        keyMask: "sk_te••••st",
        createdAt: new Date(),
      }),
    )

    const apiKey = await ensureApiKeyForWorkspace("workspace_1")

    expect(apiKey).toBe("sk_decrypted_db_key")
    expect(mocks.firstForUserEffect).toHaveBeenCalledWith("user_1")
  })

  it("falls back to the file/env key when the user has no DB keys", async () => {
    mocks.findByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "workspace_3",
        userId: "user_1",
        activeKnowhereApiKeyId: null,
        namespace: "adobe",
        createdAt: new Date(),
      }),
    )
    mocks.getActiveForWorkspaceEffect.mockReturnValue(Effect.succeed(null))
    mocks.firstForUserEffect.mockReturnValue(Effect.succeed(null))
    mocks.getDefaultKnowhereKey.mockResolvedValue({
      label: "default",
      apiKey: "sk_file_key",
    })

    const apiKey = await ensureApiKeyForWorkspace("workspace_3")

    expect(apiKey).toBe("sk_file_key")
  })

  it("throws when no key is configured anywhere", async () => {
    mocks.findByIdEffect.mockReturnValue(Effect.succeed(null))

    await expect(ensureApiKeyForWorkspace("workspace_4")).rejects.toThrow(
      /No Knowhere API key configured/,
    )
  })
})

describe("isAuthError", () => {
  it("classifies 401/403 statuses", () => {
    expect(isAuthError({ status: 401 })).toBe(true)
    expect(isAuthError({ status: 403 })).toBe(true)
    expect(isAuthError({ status: 404 })).toBe(false)
  })

  it("classifies auth phrases in error messages", () => {
    expect(isAuthError({ message: "Unauthorized" })).toBe(true)
    expect(isAuthError({ message: "Invalid API Key" })).toBe(true)
    expect(isAuthError({ message: "Internal server error" })).toBe(false)
  })

  it("classifies raw Response objects", () => {
    expect(isAuthError(new Response("x", { status: 401 }))).toBe(true)
    expect(isAuthError(new Response("x", { status: 500 }))).toBe(false)
  })

  it("returns false for non-error input", () => {
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
    expect(isAuthError("nope")).toBe(false)
  })
})
