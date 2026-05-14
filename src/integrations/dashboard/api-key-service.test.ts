import { afterEach, describe, expect, it, vi } from "vitest"

const nextCacheMocks = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}))

vi.mock("next/cache", () => nextCacheMocks)

import {
  ensureApiKeyForWorkspace,
  fetchKnowhereJwt,
  isAuthError,
} from "./api-key-service"

function getHeaderValue(headers: HeadersInit | undefined, name: string): string | null {
  if (headers === undefined) return null
  if (headers instanceof Headers) return headers.get(name)

  const lowerName = name.toLowerCase()
  if (Array.isArray(headers)) {
    const pair = headers.find(([key]) => key.toLowerCase() === lowerName)
    return pair?.[1] ?? null
  }

  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === lowerName,
  )
  return entry?.[1] ?? null
}

async function readBodyText(body: BodyInit | null | undefined): Promise<string | null> {
  if (body === undefined || body === null) return null
  if (typeof body === "string") return body
  if (body instanceof Blob) return await body.text()
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    return new TextDecoder().decode(bytes)
  }
  return null
}

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

const JWT_PATH = "/api/orpc/users/issueServiceJwt"

describe("fetchKnowhereJwt", () => {
  const originalFetch = globalThis.fetch
  const originalOrigin = process.env.DASHBOARD_ORIGIN

  afterEach(() => {
    globalThis.fetch = originalFetch
    nextCacheMocks.cacheLife.mockClear()
    nextCacheMocks.cacheTag.mockClear()
    if (originalOrigin === undefined)
      delete process.env.DASHBOARD_ORIGIN
    else process.env.DASHBOARD_ORIGIN = originalOrigin
  })

  it("POSTs to the JWT endpoint with the incoming cookie and empty JSON body", async () => {
    process.env.DASHBOARD_ORIGIN = "https://dashboard.example"
    const expectedUrl = `https://dashboard.example${JWT_PATH}`
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
    expect(url instanceof URL ? url.href : url).toBe(expectedUrl)
    expect((init as RequestInit)?.method).toBe("POST")

    const reqHeaders = (init as RequestInit)?.headers
    expect(getHeaderValue(reqHeaders, "cookie")).toBe("session=xyz; other=val")
    expect(getHeaderValue(reqHeaders, "content-type")).toContain(
      "application/json",
    )
    expect(await readBodyText((init as RequestInit)?.body)).toBe("{}")
  })

  it("throws when DASHBOARD_ORIGIN is not set", async () => {
    delete process.env.DASHBOARD_ORIGIN
    await expect(
      fetchKnowhereJwt("session=x"),
    ).rejects.toThrow(/DASHBOARD_ORIGIN/)
  })

  it("throws on non-2xx from Dashboard", async () => {
    process.env.DASHBOARD_ORIGIN = "https://dashboard.example"
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("oops", { status: 503 }))
    await expect(
      fetchKnowhereJwt("session=x"),
    ).rejects.toThrow(/Dashboard JWT issuance: non-2xx/)
  })

  it("throws on malformed response body", async () => {
    process.env.DASHBOARD_ORIGIN = "https://dashboard.example"
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ json: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    await expect(
      fetchKnowhereJwt("session=x"),
    ).rejects.toThrow(/Dashboard JWT issuance: schema mismatch .*"json":null/)
  })

  it("throws if the token string is empty", async () => {
    process.env.DASHBOARD_ORIGIN = "https://dashboard.example"
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ json: { token: "", expiresInSeconds: 900 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    await expect(
      fetchKnowhereJwt("session=x"),
    ).rejects.toThrow(/Dashboard JWT issuance: schema mismatch .*"token":""/)
  })

  it("sets cache expiration from the Dashboard JWT lifetime", async () => {
    process.env.DASHBOARD_ORIGIN = "https://dashboard.example"
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          json: { token: "jwt-short", expiresInSeconds: 45 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await expect(fetchKnowhereJwt("session=x")).resolves.toBe("jwt-short")

    expect(nextCacheMocks.cacheLife).toHaveBeenCalledWith({
      stale: 30,
      revalidate: 30,
      expire: 45,
    })
  })

  it("refreshes long-lived Dashboard JWTs before expiration", async () => {
    process.env.DASHBOARD_ORIGIN = "https://dashboard.example"
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          json: { token: "jwt-long", expiresInSeconds: 900 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await expect(fetchKnowhereJwt("session=x")).resolves.toBe("jwt-long")

    expect(nextCacheMocks.cacheLife).toHaveBeenCalledWith({
      stale: 60,
      revalidate: 60,
      expire: 900,
    })
  })
})

describe("ensureApiKeyForWorkspace", () => {
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.KNOWHERE_API_KEY
  const originalOrigin = process.env.DASHBOARD_ORIGIN

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) delete process.env.KNOWHERE_API_KEY
    else process.env.KNOWHERE_API_KEY = originalApiKey
    if (originalOrigin === undefined)
      delete process.env.DASHBOARD_ORIGIN
    else process.env.DASHBOARD_ORIGIN = originalOrigin
  })

  it("uses KNOWHERE_API_KEY without issuing a Dashboard JWT", async () => {
    process.env.KNOWHERE_API_KEY = "sk_dev_key"
    delete process.env.DASHBOARD_ORIGIN
    const fetchSpy = vi.fn<typeof fetch>()
    globalThis.fetch = fetchSpy

    const apiKey = await ensureApiKeyForWorkspace("workspace_1", "")

    expect(apiKey).toBe("sk_dev_key")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
