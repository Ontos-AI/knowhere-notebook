import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"

const mocks = vi.hoisted(() => ({
  findByIdEffect: vi.fn(),
  runPromise: vi.fn(),
  getKnowhereKeyByLabel: vi.fn(),
  getDefaultKnowhereKey: vi.fn(),
  getApiKey: vi.fn(),
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

vi.mock("@/integrations/knowhere-keys", () => ({
  getKnowhereKeyByLabel: mocks.getKnowhereKeyByLabel,
  getDefaultKnowhereKey: mocks.getDefaultKnowhereKey,
}))

vi.mock("@/integrations/knowhere-api-key", () => ({
  knowhereApiKeyOverride: {
    getApiKey: mocks.getApiKey,
  },
}))

import { ensureApiKeyForWorkspace, isAuthError } from "./knowhere-credentials"

describe("ensureApiKeyForWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runPromise.mockImplementation((effect: Effect.Effect<unknown, never, never>) =>
      Effect.runPromise(effect),
    )
    mocks.getKnowhereKeyByLabel.mockResolvedValue(null)
    mocks.getDefaultKnowhereKey.mockResolvedValue(null)
    mocks.getApiKey.mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves the workspace's knowhereKeyLabel from the key source", async () => {
    mocks.findByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "workspace_1",
        userId: "user_1",
        knowhereKeyLabel: "domainA",
        namespace: "quarterly",
        createdAt: new Date(),
      }),
    )
    mocks.getKnowhereKeyByLabel.mockResolvedValue({
      label: "domainA",
      apiKey: "sk_domain_a",
    })

    const apiKey = await ensureApiKeyForWorkspace("workspace_1")

    expect(apiKey).toBe("sk_domain_a")
    expect(mocks.getKnowhereKeyByLabel).toHaveBeenCalledWith("domainA")
  })

  it("falls back to the default key when the workspace label is missing", async () => {
    mocks.findByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "workspace_2",
        userId: "user_1",
        knowhereKeyLabel: null,
        namespace: "notebook-abc",
        createdAt: new Date(),
      }),
    )
    mocks.getDefaultKnowhereKey.mockResolvedValue({
      label: "default",
      apiKey: "sk_default",
    })

    const apiKey = await ensureApiKeyForWorkspace("workspace_2")

    expect(apiKey).toBe("sk_default")
    expect(mocks.getKnowhereKeyByLabel).toHaveBeenCalledWith("default")
  })

  it("falls back to the env override when no key source matches", async () => {
    mocks.findByIdEffect.mockReturnValue(Effect.succeed(null))
    mocks.getApiKey.mockReturnValue("sk_env_key")

    const apiKey = await ensureApiKeyForWorkspace("workspace_3")

    expect(apiKey).toBe("sk_env_key")
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
