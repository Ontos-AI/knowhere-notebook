import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockRouteClient } = vi.hoisted(() => ({
  mockRouteClient: {
    getJson: vi.fn(),
    postJsonWithStatus: vi.fn(),
    postJson: vi.fn(),
    patchJson: vi.fn(),
    patchJsonWithStatus: vi.fn(),
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

  it("retries a source with an encoded source id", async () => {
    mockRouteClient.patchJsonWithStatus.mockResolvedValue({
      status: 200,
      body: {
        source: {
          id: "source one",
          title: "notes.pdf",
          mimeType: "application/pdf",
          status: "parsing",
        },
      },
    })

    const source = await workspaceClient.retrySource("source one")

    expect(mockRouteClient.patchJsonWithStatus).toHaveBeenCalledWith(
      "/api/sources/source%20one",
      { retry: true },
    )
    expect(source).toMatchObject({
      id: "source one",
      status: "parsing",
    })
  })

  it("throws retry route errors", async () => {
    mockRouteClient.patchJsonWithStatus.mockResolvedValue({
      status: 409,
      body: {
        message:
          "This source cannot be retried because its original file is unavailable.",
      },
    })

    await expect(workspaceClient.retrySource("source_1")).rejects.toThrow(
      "This source cannot be retried because its original file is unavailable.",
    )
  })
})
