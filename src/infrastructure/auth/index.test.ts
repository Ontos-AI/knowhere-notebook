import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Tests for the auth module.
 *
 * The scope is intentionally narrow — we assert the contract with
 * Dashboard as Pi laid it out:
 *   - forward the incoming Cookie header verbatim
 *   - hit Dashboard's getCurrentUser oRPC endpoint server-side
 *   - treat `body.json.user === null` (or missing, or HTTP error, or
 *     malformed body, or network failure) as "anonymous"
 *   - never decode a JWT ourselves
 *
 * `requireUser`'s redirect behavior is not unit-tested here because
 * `next/navigation`'s `redirect` throws a framework-internal error that
 * is awkward to assert against in isolation; it is covered by the
 * Playwright flow added in a later PR.
 */

import { extractUser, sessionCookieNames } from "."

const SESSION_PATH = "/api/orpc/users/getCurrentUser"

type ParsedLogLine = {
  readonly body?: unknown
  readonly msg?: unknown
}

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

describe("extractUser", () => {
  it("returns null when body is not an object", () => {
    expect(extractUser(null)).toBeNull()
    expect(extractUser(undefined)).toBeNull()
    expect(extractUser("nope")).toBeNull()
    expect(extractUser(42)).toBeNull()
  })

  it("returns null when json envelope is missing", () => {
    expect(extractUser({})).toBeNull()
    expect(extractUser({ data: { user: { id: "u1" } } })).toBeNull()
  })

  it("returns null when user is missing or explicitly null", () => {
    expect(extractUser({ json: {} })).toBeNull()
    expect(extractUser({ json: { user: null } })).toBeNull()
  })

  it("returns null when user.id is missing or empty", () => {
    expect(extractUser({ json: { user: {} } })).toBeNull()
    expect(extractUser({ json: { user: { id: "" } } })).toBeNull()
    expect(extractUser({ json: { user: { id: 42 } } })).toBeNull()
  })

  it("returns the user with id, email, and name when present", () => {
    const got = extractUser({
      json: {
        user: { id: "user_123", email: "a@b.com", name: "Teacher" },
      },
    })
    expect(got).toEqual({
      id: "user_123",
      email: "a@b.com",
      name: "Teacher",
    })
  })

  it("coerces missing optional fields to null", () => {
    const got = extractUser({ json: { user: { id: "u1" } } })
    expect(got).toEqual({ id: "u1", email: null, name: null })
  })

  it("tolerates extra fields without failing", () => {
    const got = extractUser({
      json: {
        user: {
          id: "u1",
          email: "x@y",
          name: "N",
          someFutureField: "anything",
        },
      },
      meta: { traceId: "abc" },
    })
    expect(got?.id).toBe("u1")
  })
})

describe("sessionCookieNames", () => {
  const originalEnv = process.env.SESSION_COOKIE_NAMES
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SESSION_COOKIE_NAMES
    else process.env.SESSION_COOKIE_NAMES = originalEnv
  })

  it("defaults to the Better Auth session cookie names", () => {
    delete process.env.SESSION_COOKIE_NAMES
    expect(sessionCookieNames()).toEqual([
      "better-auth.session_token",
      "__Secure-better-auth.session_token",
    ])
  })

  it("honors a comma-separated override from env", () => {
    process.env.SESSION_COOKIE_NAMES = "my-cookie, other-cookie ,x"
    expect(sessionCookieNames()).toEqual(["my-cookie", "other-cookie", "x"])
  })

  it("falls back to defaults when the override is blank", () => {
    process.env.SESSION_COOKIE_NAMES = "   "
    expect(sessionCookieNames()).toEqual([
      "better-auth.session_token",
      "__Secure-better-auth.session_token",
    ])
  })
})

describe("getCurrentUser", () => {
  const originalFetch = globalThis.fetch
  const originalOrigin = process.env.DASHBOARD_ORIGIN

  beforeEach(() => {
    vi.resetModules()
    process.env.DASHBOARD_ORIGIN = "https://dashboard.example.test"
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOrigin === undefined) delete process.env.DASHBOARD_ORIGIN
    else process.env.DASHBOARD_ORIGIN = originalOrigin
  })

  async function loadWithCookie(cookieHeader: string) {
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers({ cookie: cookieHeader }),
      cookies: async () => ({ get: () => undefined }),
    }))
    return await import(".")
  }

  it("returns null when no Cookie header is present (no roundtrip)", async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    globalThis.fetch = fetchSpy
    const { getCurrentUser } = await loadWithCookie("")
    const got = await getCurrentUser()
    expect(got).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("POSTs to the Dashboard oRPC endpoint with the incoming Cookie", async () => {
    const expectedUrl = `https://dashboard.example.test${SESSION_PATH}`
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ json: { user: { id: "u1", email: "a@b" } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    globalThis.fetch = fetchSpy
    const { getCurrentUser } = await loadWithCookie(
      "better-auth.session_token=abc; other=val",
    )
    const user = await getCurrentUser()
    expect(user).toEqual({ id: "u1", email: "a@b", name: null })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [req, init] = fetchSpy.mock.calls[0]!
    const requestUrl =
      req instanceof Request ? req.url
      : req instanceof URL ? req.href
      : typeof req === "string" ? req
      : String(req)
    expect(requestUrl).toBe(expectedUrl)
    const requestHeaders =
      req instanceof Request ? req.headers : (init as RequestInit | undefined)?.headers
    expect(getHeaderValue(requestHeaders, "cookie")).toBe(
      "better-auth.session_token=abc; other=val",
    )
    expect(getHeaderValue(requestHeaders, "content-type")).toContain(
      "application/json",
    )
    expect(await readBodyText((init as RequestInit | undefined)?.body)).toBe("{}")
  })

  it("returns null on Dashboard non-2xx response", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("oops", { status: 503 }))
    const { getCurrentUser } = await loadWithCookie("session=x")
    expect(await getCurrentUser()).toBeNull()
  })

  it("returns null on network error without throwing", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network down"))
    const { getCurrentUser } = await loadWithCookie("session=x")
    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it("returns null when the response body is not JSON", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200 }))
    const { getCurrentUser } = await loadWithCookie("session=x")
    expect(await getCurrentUser()).toBeNull()
  })

  it("returns null when body.json.user is null", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ json: { user: null } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const { getCurrentUser } = await loadWithCookie("session=x")
    expect(await getCurrentUser()).toBeNull()
  })

  it("logs the JSON body when Dashboard returns an unexpected response shape", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ user: { id: "u1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      const { getCurrentUser } = await loadWithCookie("session=x")

      expect(await getCurrentUser()).toBeNull()

      const line = String(warnSpy.mock.calls[0]?.[0] ?? "")
      const parsed = JSON.parse(line) as ParsedLogLine
      expect(parsed.msg).toBe(
        "dashboard: POST /api/orpc/users/getCurrentUser -> schema mismatch",
      )
      expect(parsed.body).toBe(JSON.stringify({ user: { id: "u1" } }))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("throws when DASHBOARD_ORIGIN is not configured", async () => {
    delete process.env.DASHBOARD_ORIGIN
    const { getCurrentUser } = await loadWithCookie("session=x")
    await expect(getCurrentUser()).rejects.toThrow(/DASHBOARD_ORIGIN/)
  })
})
