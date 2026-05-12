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

  it("returns response status with JSON bodies when callers need route status", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const requestUrl = new URL(request.url)

      expect(request.method).toBe("POST")
      expect(requestUrl.pathname).toBe("/api/uploads")

      return Response.json({ id: "source_1" }, { status: 201 })
    })
    vi.stubGlobal("fetch", fetch)

    await expect(
      workspaceRouteClient.postJsonWithStatus<{ readonly id: string }>(
        "/api/uploads",
        {
          fileName: "notes.pdf",
        },
      ),
    ).resolves.toEqual({
      status: 201,
      body: { id: "source_1" },
    })
  })

  it("sends DELETE JSON requests through the shared browser route client", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const requestUrl = new URL(request.url)

      expect(request.method).toBe("DELETE")
      expect(requestUrl.pathname).toBe("/api/uploads")
      await expect(request.json()).resolves.toEqual({
        pathname: "source-uploads/upload_1/document.pdf",
      })

      return Response.json({ ok: true })
    })
    vi.stubGlobal("fetch", fetch)

    await expect(
      workspaceRouteClient.deleteJson<{ readonly ok: true }>("/api/uploads", {
        pathname: "source-uploads/upload_1/document.pdf",
      }),
    ).resolves.toEqual({ ok: true })
  })
})
