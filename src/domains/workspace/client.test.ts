import { beforeEach, describe, expect, it, vi } from "vitest"

import { workspaceClient } from "./client"

describe("workspaceClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("fetches a normalized chunk page with an encoded source id", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const requestUrl = new URL(String(input), "http://localhost")

      expect(requestUrl.pathname).toBe("/api/sources/source%20one/chunks")
      expect(requestUrl.searchParams.get("page")).toBe("2")
      expect(requestUrl.searchParams.get("pageSize")).toBe("100")

      return Response.json({
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "Chunk body",
            sourceTitle: "source one",
          },
        ],
        pagination: {
          page: 2,
          pageSize: 100,
          total: 3,
          totalPages: 3,
        },
      })
    })
    vi.stubGlobal("fetch", fetch)

    const page = await workspaceClient.fetchChunkPage("source one", 2)

    expect(page).toEqual({
      chunks: [
        {
          chunkId: "chunk_1",
          type: "text",
          content: "Chunk body",
          sourceTitle: "source one",
        },
      ],
      pagination: {
        page: 2,
        pageSize: 100,
        total: 3,
        totalPages: 3,
      },
    })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
