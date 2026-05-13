import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockRouteClient } = vi.hoisted(() => ({
  mockRouteClient: {
    getJson: vi.fn(),
    postJsonWithStatus: vi.fn(),
    postJson: vi.fn(),
    patchJson: vi.fn(),
    deleteJson: vi.fn(),
  },
}))

vi.mock("./route-client", () => ({
  workspaceRouteClient: mockRouteClient,
}))

import { workspaceClient } from "./client"

describe("workspaceClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetches a normalized chunk page with an encoded source id", async () => {
    mockRouteClient.getJson.mockResolvedValue({
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
        pageSize: 50,
        total: 3,
        totalPages: 3,
      },
    })

    const page = await workspaceClient.fetchChunkPage("source one", 2)

    expect(mockRouteClient.getJson).toHaveBeenCalledWith(
      "/api/sources/source%20one/chunks?page=2&pageSize=50",
    )
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
        pageSize: 50,
        total: 3,
        totalPages: 3,
      },
    })
  })

  it("throws materialization route errors instead of treating them as empty sources", async () => {
    mockRouteClient.postJsonWithStatus.mockResolvedValue({
      status: 502,
      body: { message: "Demo sources could not be prepared right now." },
    })

    await expect(
      workspaceClient.materializeDemoSources({
        demoSourceIds: ["demo-tsla-q4-2025"],
      }),
    ).rejects.toThrow("Demo sources could not be prepared right now.")
  })
})
