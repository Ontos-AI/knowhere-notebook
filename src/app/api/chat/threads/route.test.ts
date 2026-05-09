import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createChatThread: vi.fn(),
  ensureWorkspace: vi.fn(),
  listChatThreadsForWorkspace: vi.fn(),
  requireUser: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}))

vi.mock("@/lib/workspace", () => ({
  createChatThread: mocks.createChatThread,
  ensureWorkspace: mocks.ensureWorkspace,
  listChatThreadsForWorkspace: mocks.listChatThreadsForWorkspace,
}))

import { GET, POST } from "./route"

describe("/api/chat/threads", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists the current user's non-deleted chat threads", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" })
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" })
    mocks.listChatThreadsForWorkspace.mockResolvedValue([
      makeThread({ id: "thread_2", title: "Second question" }),
      makeThread({ id: "thread_1", title: null }),
    ])

    const response = await GET()

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
    expect(mocks.listChatThreadsForWorkspace).toHaveBeenCalledWith(
      "workspace_1",
    )
  })

  it("creates a fresh empty chat thread", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" })
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" })
    mocks.createChatThread.mockResolvedValue(
      makeThread({ id: "thread_new", title: null }),
    )

    const response = await POST()

    await expect(response.json()).resolves.toEqual({
      thread: {
        id: "thread_new",
        title: "New chat",
        createdAt: "2026-05-06T00:00:00.000Z",
        updatedAt: "2026-05-06T00:00:00.000Z",
      },
      messages: [],
    })
    expect(mocks.createChatThread).toHaveBeenCalledWith("workspace_1")
  })
})

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread_1",
    workspaceId: "workspace_1",
    title: "Chat title",
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}
