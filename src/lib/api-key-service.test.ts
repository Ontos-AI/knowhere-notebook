import { describe, expect, it, vi } from "vitest"

vi.mock("./db", () => ({
  db: {},
  DbClient: {},
  dbLayer: {},
}))

import { isAuthError } from "./api-key-service"

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
