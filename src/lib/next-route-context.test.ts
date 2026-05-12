import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
}))

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}))

import { nextRouteContext } from "./next-route-context"

describe("nextRouteContext", () => {
  it("reads the cookie header once for route services", async () => {
    mocks.headers.mockResolvedValue(new Headers({ cookie: "session=abc" }))

    await expect(nextRouteContext.read()).resolves.toEqual({
      cookieHeader: "session=abc",
    })
  })
})
