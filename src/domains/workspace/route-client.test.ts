import { beforeEach, describe, expect, it, vi } from "vitest"

import { workspaceRouteClient } from "./route-client"

describe("workspaceRouteClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends JSON requests through same-origin route paths", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const requestUrl = new URL(request.url)

      expect(request.method).toBe("POST")
      expect(requestUrl.pathname).toBe("/api/workspace")
      await expect(request.json()).resolves.toEqual({ name: "Notebook" })

      return Response.json({ ok: true })
    })
    vi.stubGlobal("fetch", fetch)

    await expect(
      workspaceRouteClient.postJson<{ ok: true }>("/api/workspace", {
        name: "Notebook",
      }),
    ).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
