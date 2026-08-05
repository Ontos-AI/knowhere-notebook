import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"

const repositoryMocks = vi.hoisted(() => ({
  findByIdEffect: vi.fn(),
  findUserByIdEffect: vi.fn(),
  runPromise: vi.fn(),
}))

vi.mock("./sessions-repository", () => ({
  sessionsRepository: {
    findByIdEffect: repositoryMocks.findByIdEffect,
  },
}))

vi.mock("./users-repository", () => ({
  usersRepository: {
    findByIdEffect: repositoryMocks.findUserByIdEffect,
  },
}))

vi.mock("@/domains/workspace/database-runtime", () => ({
  databaseRuntime: {
    runPromise: repositoryMocks.runPromise,
  },
}))

/**
 * Tests for the Phase 2+ auth module.
 *
 * The scope is intentionally narrow — we assert the Notebook-owned session
 * contract:
 *   - no session cookie → null (no DB roundtrip)
 *   - a valid session id → session row → users row → AuthUser
 *   - expired / missing session or user → null
 *   - `requireUser` throws a redirect when unauthenticated
 */

import { extractUser } from "."

describe("extractUser", () => {
  it("returns null when value is not an object", () => {
    expect(extractUser(null)).toBeNull()
    expect(extractUser(undefined)).toBeNull()
    expect(extractUser("nope")).toBeNull()
    expect(extractUser(42)).toBeNull()
  })

  it("returns null when id is missing or empty", () => {
    expect(extractUser({})).toBeNull()
    expect(extractUser({ id: "" })).toBeNull()
    expect(extractUser({ id: 42 })).toBeNull()
  })

  it("returns the user with id, email, and name when present", () => {
    expect(extractUser({ id: "u1", email: "a@b.com", name: "Ada" })).toEqual({
      id: "u1",
      email: "a@b.com",
      name: "Ada",
    })
  })

  it("coerces missing optional fields to null", () => {
    expect(extractUser({ id: "u1" })).toEqual({ id: "u1", email: null, name: null })
  })
})

describe("getCurrentUser", () => {
  const originalApiKey = process.env.KNOWHERE_API_KEY

  beforeEach(() => {
    vi.resetModules()
    delete process.env.KNOWHERE_API_KEY
    repositoryMocks.runPromise.mockReset()
    repositoryMocks.findByIdEffect.mockReset()
    repositoryMocks.findUserByIdEffect.mockReset()
    // Run the effect for real so the mocked repository Effects are executed.
    repositoryMocks.runPromise.mockImplementation((effect: Effect.Effect<unknown, never, never>) =>
      Effect.runPromise(effect),
    )
  })

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.KNOWHERE_API_KEY
    else process.env.KNOWHERE_API_KEY = originalApiKey
  })

  async function loadWithCookie(cookieHeader: string) {
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers({ cookie: cookieHeader }),
      cookies: async () => ({ get: () => undefined }),
    }))
    return await import(".")
  }

  it("returns null when no Cookie header is present", async () => {
    const { getCurrentUser } = await loadWithCookie("")
    expect(await getCurrentUser()).toBeNull()
    expect(repositoryMocks.runPromise).not.toHaveBeenCalled()
  })

  it("returns the user for a valid session cookie", async () => {
    repositoryMocks.findByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "session_1",
        userId: "user_1",
        expiresAt: new Date(Date.now() + 100_000),
        createdAt: new Date(),
      }),
    )
    repositoryMocks.findUserByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "user_1",
        email: "ada@example.com",
        name: "Ada",
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }),
    )
    const { getCurrentUser } = await loadWithCookie("notebook-session=session_1")
    const user = await getCurrentUser()
    expect(user).toEqual({ id: "user_1", email: "ada@example.com", name: "Ada" })
  })

  it("returns null when the session row is missing", async () => {
    repositoryMocks.findByIdEffect.mockReturnValue(Effect.succeed(null))
    const { getCurrentUser } = await loadWithCookie("notebook-session=missing")
    expect(await getCurrentUser()).toBeNull()
  })

  it("returns null when the session's user row is missing", async () => {
    repositoryMocks.findByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "session_1",
        userId: "user_gone",
        expiresAt: new Date(Date.now() + 100_000),
        createdAt: new Date(),
      }),
    )
    repositoryMocks.findUserByIdEffect.mockReturnValue(Effect.succeed(null))
    const { getCurrentUser } = await loadWithCookie("notebook-session=session_1")
    expect(await getCurrentUser()).toBeNull()
  })

  it("returns null on DB failure without throwing", async () => {
    repositoryMocks.runPromise.mockRejectedValue(new Error("db down"))
    const { getCurrentUser } = await loadWithCookie("notebook-session=session_1")
    expect(await getCurrentUser()).toBeNull()
  })

  it("throws a redirect when requireUser is called unauthenticated", async () => {
    const { requireUser } = await loadWithCookie("")
    await expect(requireUser()).rejects.toThrow(/NEXT_REDIRECT/)
  })
})
