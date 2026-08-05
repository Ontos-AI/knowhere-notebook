import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  getOAuthProvider,
  listOAuthProviders,
} from "./oauth-providers"

describe("oauth-providers", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OAUTH_GOOGLE_CLIENT_ID
    delete process.env.OAUTH_GOOGLE_CLIENT_SECRET
    delete process.env.OAUTH_GITHUB_CLIENT_ID
    delete process.env.OAUTH_GITHUB_CLIENT_SECRET
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("returns no providers when none are configured", () => {
    expect(listOAuthProviders()).toEqual([])
    expect(getOAuthProvider("google")).toBeNull()
  })

  it("lists only providers with both env credentials", () => {
    process.env.OAUTH_GOOGLE_CLIENT_ID = "google_id"
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = "google_secret"

    const providers = listOAuthProviders()

    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({
      name: "google",
      displayName: "Google",
      clientId: "google_id",
      clientSecret: "google_secret",
    })
    expect(getOAuthProvider("google")).not.toBeNull()
    expect(getOAuthProvider("github")).toBeNull()
  })

  it("lists multiple configured providers", () => {
    process.env.OAUTH_GOOGLE_CLIENT_ID = "g"
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = "g"
    process.env.OAUTH_GITHUB_CLIENT_ID = "h"
    process.env.OAUTH_GITHUB_CLIENT_SECRET = "h"

    expect(listOAuthProviders().map((p) => p.name)).toEqual([
      "google",
      "github",
    ])
  })
})
