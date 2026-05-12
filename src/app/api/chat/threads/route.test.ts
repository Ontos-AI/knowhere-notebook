import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createThread: vi.fn(),
  listThreads: vi.fn(),
}))

vi.mock("@/domains/chat/route-threads", () => ({
  chatThreadRouteService: {
    createThread: mocks.createThread,
    listThreads: mocks.listThreads,
  },
}))

import { GET, POST } from "./route"

describe("/api/chat/threads", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the current user's non-deleted chat threads", async () => {
    mocks.listThreads.mockResolvedValue({
      status: 200,
      body: {
        threads: [
          {
            id: "thread_2",
            title: "Second question",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
          {
            id: "thread_1",
            title: "New chat",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
        ],
      },
    })

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      threads: [
        {
          id: "thread_2",
          title: "Second question",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
        {
          id: "thread_1",
          title: "New chat",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
      ],
    })
    expect(mocks.listThreads).toHaveBeenCalledOnce()
  })

  it("returns a fresh empty chat thread", async () => {
    mocks.createThread.mockResolvedValue({
      status: 200,
      body: {
        thread: {
          id: "thread_new",
          title: "New chat",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
        messages: [],
      },
    })

    const response = await POST()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      thread: {
        id: "thread_new",
        title: "New chat",
        createdAt: "2026-05-06T00:00:00.000Z",
        updatedAt: "2026-05-06T00:00:00.000Z",
      },
      messages: [],
    })
    expect(mocks.createThread).toHaveBeenCalledOnce()
  })
})
