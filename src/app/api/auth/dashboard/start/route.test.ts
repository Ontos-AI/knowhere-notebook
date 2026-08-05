import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  getDashboardProvider: vi.fn(),
  loginWithDashboardSession: vi.fn(),
  DashboardLoginError: class extends Error {
    readonly code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
  cookieJar: {
    getAll: vi.fn<() => { name: string; value: string }[]>(() => []),
  },
}))

vi.mock("@/infrastructure/auth/oauth-providers", () => ({
  getDashboardProvider: mocks.getDashboardProvider,
}))

vi.mock("@/infrastructure/auth/oauth", () => ({
  loginWithDashboardSession: mocks.loginWithDashboardSession,
  DashboardLoginError: mocks.DashboardLoginError,
}))

vi.mock("next/headers", () => ({
  cookies: async () => mocks.cookieJar,
}))

import { GET } from "./route"

describe("GET /api/auth/dashboard/start", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("404s when the dashboard provider is not configured", async () => {
    mocks.getDashboardProvider.mockReturnValue(null)

    const response = await GET(new NextRequest("http://localhost:3001/api/auth/dashboard/start"))
    const body = (await response.json()) as { message?: string }

    expect(response.status).toBe(404)
    expect(body.message).toMatch(/DASHBOARD_ORIGIN/i)
  })

  it("returns the app URL after a successful login", async () => {
    mocks.getDashboardProvider.mockReturnValue({
      kind: "dashboard",
      name: "dashboard",
      displayName: "Dashboard",
      dashboardOrigin: "http://localhost:3000",
    })
    mocks.loginWithDashboardSession.mockResolvedValue("/")
    mocks.cookieJar.getAll.mockReturnValue([
      { name: "better-auth.session_token", value: "abc" },
      { name: "notebook-session", value: "xyz" },
    ])

    const request = new NextRequest("http://localhost:3001/api/auth/dashboard/start")
    const response = await GET(request)
    const body = (await response.json()) as { url?: string }

    expect(response.status).toBe(200)
    expect(body.url).toBe("/")
    expect(mocks.loginWithDashboardSession).toHaveBeenCalledWith(
      "better-auth.session_token=abc; notebook-session=xyz",
      "http://localhost:3000",
    )
  })

  it("surfaces the no-dashboard-session error as 401", async () => {
    mocks.getDashboardProvider.mockReturnValue({
      kind: "dashboard",
      name: "dashboard",
      displayName: "Dashboard",
      dashboardOrigin: "http://localhost:3000",
    })
    mocks.loginWithDashboardSession.mockRejectedValue(
      new mocks.DashboardLoginError(
        "no-dashboard-session",
        "You are not logged into the Knowhere Dashboard.",
      ),
    )

    const response = await GET(new NextRequest("http://localhost:3001/api/auth/dashboard/start"))
    const body = (await response.json()) as { message?: string }

    expect(response.status).toBe(401)
    expect(body.message).toMatch(/Dashboard/i)
  })

  it("surfaces the email-collision error as 409", async () => {
    mocks.getDashboardProvider.mockReturnValue({
      kind: "dashboard",
      name: "dashboard",
      displayName: "Dashboard",
      dashboardOrigin: "http://localhost:3000",
    })
    mocks.loginWithDashboardSession.mockRejectedValue(
      new mocks.DashboardLoginError("email-collision", "collision"),
    )

    const response = await GET(new NextRequest("http://localhost:3001/api/auth/dashboard/start"))
    const body = (await response.json()) as { message?: string }

    expect(response.status).toBe(409)
    expect(body.message).toBe("collision")
  })

  it("returns 500 for unexpected failures", async () => {
    mocks.getDashboardProvider.mockReturnValue({
      kind: "dashboard",
      name: "dashboard",
      displayName: "Dashboard",
      dashboardOrigin: "http://localhost:3000",
    })
    mocks.loginWithDashboardSession.mockRejectedValue(new Error("boom"))

    const response = await GET(new NextRequest("http://localhost:3001/api/auth/dashboard/start"))

    expect(response.status).toBe(500)
  })
})
