import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./db", () => ({
  db: {},
  DbClient: {},
  dbLayer: {},
}))

import { fetchKnowhereJwt, isAuthError } from "./api-key-service"

describe("isAuthError", () => {
  it("detects 401 status on a Response object", () => {
    expect(isAuthError(new Response(null, { status: 401 }))).toBe(true)
  })

  it("detects 403 status on a Response object", () => {
    expect(isAuthError(new Response(null, { status: 403 }))).toBe(true)
  })

  it("returns false for non-auth status on Response", () => {
    expect(isAuthError(new Response(null, { status: 500 }))).toBe(false)
    expect(isAuthError(new Response(null, { status: 200 }))).toBe(false)
  })

  it("detects 401 on an object with status property", () => {
    expect(isAuthError({ status: 401 })).toBe(true)
  })

  it("detects 403 on an object with statusCode property", () => {
    expect(isAuthError({ statusCode: 403 })).toBe(true)
  })

  it("detects auth-related substrings in error message", () => {
    expect(isAuthError({ message: "Unauthorized request" })).toBe(true)
    expect(isAuthError({ message: "Forbidden" })).toBe(true)
    expect(isAuthError({ message: "Invalid API key" })).toBe(true)
    expect(isAuthError({ message: "Auth error occurred" })).toBe(true)
    expect(isAuthError({ message: "unauthenticated" })).toBe(true)
  })

  it("detects 401/403 in error message string", () => {
    expect(isAuthError({ message: "HTTP 401: bad credentials" })).toBe(true)
    expect(isAuthError({ message: "Got 403 from server" })).toBe(true)
  })

  it("returns false for null / undefined / non-matching errors", () => {
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
    expect(isAuthError({})).toBe(false)
    expect(isAuthError({ message: "Network timeout" })).toBe(false)
    expect(isAuthError(new Error("Something went wrong"))).toBe(false)
  })
})

describe("fetchKnowhereJwt", () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.DASHBOARD_KNOWHERE_TOKEN_URL

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined)
      delete process.env.DASHBOARD_KNOWHERE_TOKEN_URL
    else process.env.DASHBOARD_KNOWHERE_TOKEN_URL = originalUrl
  })

  it("POSTs to the JWT endpoint with the incoming cookie and empty JSON body", async () => {
    process.env.DASHBOARD_KNOWHERE_TOKEN_URL =
      "https://dashboard.example/api/orpc/users/issueServiceJwt"
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          json: { token: "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InVzZXIifQ.abc", expiresInSeconds: 900 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    globalThis.fetch = fetchSpy

    const token = await fetchKnowhereJwt("session=xyz; other=val")

    expect(token).toBe("eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InVzZXIifQ.abc")
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(process.env.DASHBOARD_KNOWHERE_TOKEN_URL)
    expect((init as RequestInit)?.method).toBe("POST")
    expect((init as RequestInit)?.body).toBe("{}")
    expect((init as RequestInit)?.headers).toMatchObject({
      cookie: "session=xyz; other=val",
      "content-type": "application/json",
    })
  })

  it("throws when DASHBOARD_KNOWHERE_TOKEN_URL is not set", async () => {
    delete process.env.DASHBOARD_KNOWHERE_TOKEN_URL
    await expect(
      fetchKnowhereJwt("session=x"),
    ).rejects.toThrow(/DASHBOARD_KNOWHERE_TOKEN_URL/)
  })

  it("throws on non-2xx from Dashboard", async () => {
    process.env.DASHBOARD_KNOWHERE_TOKEN_URL = "https://dashboard.example/api/orpc/users/issueServiceJwt"
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("oops", { status: 503 }))
    await expect(
      fetchKnowhereJwt("session=x"),
    ).rejects.toThrow(/503/)
  })

  it("throws on malformed response body", async () => {
    process.env.DASHBOARD_KNOWHERE_TOKEN_URL = "https://dashboard.example/api/orpc/users/issueServiceJwt"
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ json: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    await expect(
      fetchKnowhereJwt("session=x"),
    ).rejects.toThrow(/Unexpected/)
  })

  it("throws if the token string is empty", async () => {
    process.env.DASHBOARD_KNOWHERE_TOKEN_URL = "https://dashboard.example/api/orpc/users/issueServiceJwt"
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ json: { token: "", expiresInSeconds: 900 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    await expect(
      fetchKnowhereJwt("session=x"),
    ).rejects.toThrow(/Unexpected/)
  })
})
