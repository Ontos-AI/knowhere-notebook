import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  getDashboardProvider,
  getOAuthProvider,
  listLoginProviders,
  listOAuthProviders,
} from "./oauth-providers"

describe("oauth-providers", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OAUTH_GOOGLE_CLIENT_ID
    delete process.env.OAUTH_GOOGLE_CLIENT_SECRET
    delete process.env.OAUTH_GITHUB_CLIENT_ID
    delete process.env.OAUTH_GITHUB_CLIENT_SECRET
    delete process.env.DASHBOARD_ORIGIN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("returns no providers when none are configured", () => {
    expect(listOAuthProviders()).toEqual([])
    expect(getOAuthProvider("google")).toBeNull()
    expect(getDashboardProvider()).toBeNull()
    expect(listLoginProviders()).toEqual([])
  })

  it("lists only providers with both env credentials", () => {
    process.env.OAUTH_GOOGLE_CLIENT_ID = "google_id"
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = "google_secret"

    const providers = listOAuthProviders()

    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({
      kind: "oauth",
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

  it("offers the dashboard provider only when DASHBOARD_ORIGIN is set", () => {
    expect(getDashboardProvider()).toBeNull()

    process.env.DASHBOARD_ORIGIN = "http://localhost:3000"

    expect(getDashboardProvider()).toEqual({
      kind: "dashboard",
      name: "dashboard",
      displayName: "Dashboard",
      dashboardOrigin: "http://localhost:3000",
    })
  })

  it("puts the dashboard provider first in the login list", () => {
    process.env.DASHBOARD_ORIGIN = "http://localhost:3000"
    process.env.OAUTH_GOOGLE_CLIENT_ID = "g"
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = "g"

    expect(listLoginProviders()).toEqual([
      { name: "dashboard", displayName: "Dashboard" },
      { name: "google", displayName: "Google" },
    ])
  })
})
