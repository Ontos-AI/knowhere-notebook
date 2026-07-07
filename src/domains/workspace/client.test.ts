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

  it("preserves source chunk processing messages", async () => {
    mockRouteClient.getJson.mockResolvedValue({
      chunks: [],
      message: "Source parsed snapshot is still being prepared.",
      pagination: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 0,
      },
    })

    const page = await workspaceClient.fetchChunkPage("source_1", 1)

    expect(page).toEqual({
      chunks: [],
      isProcessing: true,
      message: "Source parsed snapshot is still being prepared.",
      pagination: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 0,
      },
    })
  })

  it("preserves source chunk unavailable messages without processing state", async () => {
    mockRouteClient.getJson.mockResolvedValue({
      chunks: [],
      message:
        "Source is unavailable. The parsed document is not available locally and could not be loaded from Knowhere.",
      isUnavailable: true,
      pagination: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 0,
      },
    })

    const page = await workspaceClient.fetchChunkPage("source_1", 1)

    expect(page).toEqual({
      chunks: [],
      isUnavailable: true,
      message:
        "Source is unavailable. The parsed document is not available locally and could not be loaded from Knowhere.",
      pagination: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 0,
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
