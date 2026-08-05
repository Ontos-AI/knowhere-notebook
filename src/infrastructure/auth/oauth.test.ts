import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"

const mocks = vi.hoisted(() => ({
  runPromise: vi.fn(),
  findByProviderAndProviderUserIdEffect: vi.fn(),
  findByIdEffect: vi.fn(),
  findByEmailEffect: vi.fn(),
  findByUserIdAndProviderEffect: vi.fn(),
  insertUserEffect: vi.fn(),
  insertLinkEffect: vi.fn(),
  createSession: vi.fn(),
  cookieJar: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock("@/domains/workspace/database-runtime", () => ({
  databaseRuntime: {
    runPromise: mocks.runPromise,
  },
}))

vi.mock("@/infrastructure/auth/users-repository", () => ({
  usersRepository: {
    findByIdEffect: mocks.findByIdEffect,
    findByEmailEffect: mocks.findByEmailEffect,
    insertEffect: mocks.insertUserEffect,
  },
}))

vi.mock("@/infrastructure/auth/account-links-repository", () => ({
  accountLinksRepository: {
    findByProviderAndProviderUserIdEffect:
      mocks.findByProviderAndProviderUserIdEffect,
    findByUserIdAndProviderEffect: mocks.findByUserIdAndProviderEffect,
    insertEffect: mocks.insertLinkEffect,
  },
}))

vi.mock("@/infrastructure/auth/session", () => ({
  createSession: mocks.createSession,
}))

vi.mock("next/headers", () => ({
  cookies: async () => mocks.cookieJar,
}))

import {
  buildOAuthAuthorizeUrl,
  completeOAuthLogin,
  loginWithDashboardSession,
} from "./oauth"
import type { OAuthProviderConfig } from "./oauth-providers"

const provider: OAuthProviderConfig = {
  kind: "oauth",
  name: "google",
  displayName: "Google",
  clientId: "google_id",
  clientSecret: "google_secret",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  scope: "openid email profile",
  emailKey: "email",
  idKey: "sub",
  nameKey: "name",
}

describe("oauth flow", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runPromise.mockImplementation(
      (effect: Effect.Effect<unknown, never, never>) =>
        Effect.runPromise(effect),
    )
    mocks.cookieJar.get.mockReturnValue(undefined)
    mocks.cookieJar.delete.mockReturnValue(undefined)
    mocks.cookieJar.set.mockReturnValue(undefined)
    mocks.createSession.mockResolvedValue("session_1")
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("builds an authorize URL with state and PKCE challenge", async () => {
    const { url, state } = await buildOAuthAuthorizeUrl(
      provider,
      "http://localhost/api/auth/google/callback",
    )

    const parsed = new URL(url)
    expect(parsed.searchParams.get("client_id")).toBe("google_id")
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/auth/google/callback",
    )
    expect(parsed.searchParams.get("response_type")).toBe("code")
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256")
    expect(parsed.searchParams.get("state")).toBe(state)
    expect(parsed.searchParams.get("code_challenge")).toBeTruthy()
    expect(state.length).toBeGreaterThan(10)
    expect(mocks.cookieJar.set).toHaveBeenCalledTimes(2)
  })

  it("exchanges the code, fetches userinfo, and creates a session for a new user", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "tok_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sub: "provider_1", email: "ada@example.com", name: "Ada" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

    mocks.cookieJar.get.mockImplementation((name: string) =>
      name === "oauth-state"
        ? { value: "state_abc" }
        : { value: "verifier_xyz" },
    )
    mocks.findByProviderAndProviderUserIdEffect.mockReturnValue(
      Effect.succeed(null),
    )
    mocks.insertUserEffect.mockReturnValue(
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
    mocks.insertLinkEffect.mockReturnValue(
      Effect.succeed({
        id: "link_1",
        userId: "user_1",
        provider: "google",
        providerUserId: "provider_1",
        passwordHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )

    const destination = await completeOAuthLogin(
      provider,
      "http://localhost/api/auth/google/callback",
      "code_123",
      "state_abc",
    )

    expect(destination).toBe("/")
    expect(mocks.findByProviderAndProviderUserIdEffect).toHaveBeenCalledWith(
      "google",
      "provider_1",
    )
    expect(mocks.insertUserEffect).toHaveBeenCalledWith({
      email: "ada@example.com",
      name: "Ada",
    })
    expect(mocks.insertLinkEffect).toHaveBeenCalledWith({
      userId: "user_1",
      provider: "google",
      providerUserId: "provider_1",
      passwordHash: null,
    })
    expect(mocks.createSession).toHaveBeenCalledWith("user_1")
  })

  it("reuses an existing user when the provider link already exists", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "tok_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sub: "provider_1", email: "ada@example.com" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

    mocks.cookieJar.get.mockImplementation((name: string) =>
      name === "oauth-state"
        ? { value: "state_abc" }
        : { value: "verifier_xyz" },
    )
    mocks.findByProviderAndProviderUserIdEffect.mockReturnValue(
      Effect.succeed({
        id: "link_1",
        userId: "user_1",
        provider: "google",
        providerUserId: "provider_1",
        passwordHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    mocks.findByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "user_1",
        email: "ada@example.com",
        name: null,
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }),
    )

    await completeOAuthLogin(
      provider,
      "http://localhost/api/auth/google/callback",
      "code_123",
      "state_abc",
    )

    expect(mocks.insertUserEffect).not.toHaveBeenCalled()
    expect(mocks.createSession).toHaveBeenCalledWith("user_1")
  })

  it("rejects a mismatched state", async () => {
    mocks.cookieJar.get.mockReturnValue("other_state")

    await expect(
      completeOAuthLogin(
        provider,
        "http://localhost/api/auth/google/callback",
        "code_123",
        "state_abc",
      ),
    ).rejects.toThrow(/state mismatch/)
  })

  it("rejects a failed token exchange", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("denied", { status: 401 }))

    mocks.cookieJar.get.mockImplementation((name: string) =>
      name === "oauth-state"
        ? { value: "state_abc" }
        : { value: "verifier_xyz" },
    )

    await expect(
      completeOAuthLogin(
        provider,
        "http://localhost/api/auth/google/callback",
        "code_123",
        "state_abc",
      ),
    ).rejects.toThrow(/token exchange failed/)
  })
})

describe("dashboard session handoff", () => {
  const originalFetch = globalThis.fetch
  const dashboardOrigin = "http://localhost:3000"
  const dashboardUser = {
    id: "dash_1",
    email: "gordon@example.com",
    name: "Gordon",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runPromise.mockImplementation(
      (effect: Effect.Effect<unknown, never, never>) =>
        Effect.runPromise(effect),
    )
    mocks.createSession.mockResolvedValue("session_dash")
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockDashboardResponse(user: unknown) {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ json: { user } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
  }

  it("forwards the browser cookie and logs in an existing linked user", async () => {
    mockDashboardResponse(dashboardUser)
    mocks.findByProviderAndProviderUserIdEffect.mockReturnValue(
      Effect.succeed({
        id: "link_dash",
        userId: "user_1",
        provider: "dashboard",
        providerUserId: "dash_1",
        passwordHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    mocks.findByIdEffect.mockReturnValue(
      Effect.succeed({
        id: "user_1",
        email: "gordon@example.com",
        name: "Gordon",
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }),
    )

    const destination = await loginWithDashboardSession(
      "better-auth.session_token=abc; notebook-session=xyz",
      dashboardOrigin,
    )

    expect(destination).toBe("/")
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/orpc/users.getCurrentUser",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          "content-type": "application/json",
          cookie: "better-auth.session_token=abc; notebook-session=xyz",
        }),
      }),
    )
    expect(mocks.createSession).toHaveBeenCalledWith("user_1")
  })

  it("creates a new user on first dashboard login", async () => {
    mockDashboardResponse({ id: "dash_9", email: "new@example.com", name: "New" })
    mocks.findByProviderAndProviderUserIdEffect.mockReturnValue(
      Effect.succeed(null),
    )
    mocks.findByEmailEffect.mockReturnValue(Effect.succeed(null))
    mocks.insertUserEffect.mockReturnValue(
      Effect.succeed({
        id: "user_9",
        email: "new@example.com",
        name: "New",
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }),
    )
    mocks.insertLinkEffect.mockReturnValue(
      Effect.succeed({
        id: "link_9",
        userId: "user_9",
        provider: "dashboard",
        providerUserId: "dash_9",
        passwordHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )

    await loginWithDashboardSession("better-auth.session_token=abc", dashboardOrigin)

    expect(mocks.insertUserEffect).toHaveBeenCalledWith({
      email: "new@example.com",
      name: "New",
    })
    expect(mocks.insertLinkEffect).toHaveBeenCalledWith({
      userId: "user_9",
      provider: "dashboard",
      providerUserId: "dash_9",
      passwordHash: null,
    })
    expect(mocks.createSession).toHaveBeenCalledWith("user_9")
  })

  it("adopts an existing user by email when they have no password", async () => {
    mockDashboardResponse(dashboardUser)
    mocks.findByProviderAndProviderUserIdEffect.mockReturnValue(
      Effect.succeed(null),
    )
    mocks.findByEmailEffect.mockReturnValue(
      Effect.succeed({
        id: "user_1",
        email: "gordon@example.com",
        name: null,
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }),
    )
    mocks.findByUserIdAndProviderEffect.mockReturnValue(
      Effect.succeed(null),
    )
    mocks.insertLinkEffect.mockReturnValue(
      Effect.succeed({
        id: "link_1",
        userId: "user_1",
        provider: "dashboard",
        providerUserId: "dash_1",
        passwordHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )

    await loginWithDashboardSession("better-auth.session_token=abc", dashboardOrigin)

    expect(mocks.insertUserEffect).not.toHaveBeenCalled()
    expect(mocks.insertLinkEffect).toHaveBeenCalledWith({
      userId: "user_1",
      provider: "dashboard",
      providerUserId: "dash_1",
      passwordHash: null,
    })
    expect(mocks.createSession).toHaveBeenCalledWith("user_1")
  })

  it("refuses to adopt a password-protected user with the same email", async () => {
    mockDashboardResponse(dashboardUser)
    mocks.findByProviderAndProviderUserIdEffect.mockReturnValue(
      Effect.succeed(null),
    )
    mocks.findByEmailEffect.mockReturnValue(
      Effect.succeed({
        id: "user_1",
        email: "gordon@example.com",
        name: null,
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }),
    )
    mocks.findByUserIdAndProviderEffect.mockReturnValue(
      Effect.succeed({
        id: "link_pass",
        userId: "user_1",
        provider: "password",
        providerUserId: null,
        passwordHash: "$argon2id$abc",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )

    await expect(
      loginWithDashboardSession(
        "better-auth.session_token=abc",
        dashboardOrigin,
      ),
    ).rejects.toMatchObject({
      code: "email-collision",
    })
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it("fails with no-dashboard-session when the dashboard has no user", async () => {
    mockDashboardResponse(null)

    await expect(
      loginWithDashboardSession(
        "better-auth.session_token=abc",
        dashboardOrigin,
      ),
    ).rejects.toMatchObject({
      code: "no-dashboard-session",
    })
    expect(mocks.createSession).not.toHaveBeenCalled()
  })
})
