import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  ensureWorkspace: vi.fn(),
  findChatThreadInWorkspace: vi.fn(),
  listMessagesForThread: vi.fn(),
  requireUser: vi.fn(),
  softDeleteChatThread: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}))

vi.mock("@/domains/workspace", () => ({
  ensureWorkspace: mocks.ensureWorkspace,
  findChatThreadInWorkspace: mocks.findChatThreadInWorkspace,
  listMessagesForThread: mocks.listMessagesForThread,
  softDeleteChatThread: mocks.softDeleteChatThread,
}))

import { GET, PATCH } from "./route"

describe("/api/chat/threads/[threadId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads a thread transcript only from the current workspace", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" })
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" })
    mocks.findChatThreadInWorkspace.mockResolvedValue(
      makeThread({ title: "Revenue" }),
    )
    mocks.listMessagesForThread.mockResolvedValue([
      makeMessage({ id: "message_1", role: "user", content: "Question" }),
      makeMessage({
        id: "message_2",
        role: "assistant",
        content: "Answer",
        citations: [
          {
            chunkType: "text",
            score: 0.9,
            source: {
              documentId: "doc_1",
              sourceFileName: "report.pdf",
              sectionPath: "Results",
            },
          },
        ],
      }),
    ])

    const response = await GET(
      new NextRequest("http://localhost:3001/api/chat/threads/thread_1"),
      { params: Promise.resolve({ threadId: "thread_1" }) },
    )

    await expect(response.json()).resolves.toEqual({
      thread: {
        id: "thread_1",
        title: "Revenue",
        createdAt: "2026-05-06T00:00:00.000Z",
        updatedAt: "2026-05-06T00:00:00.000Z",
      },
      messages: [
        { id: "message_1", role: "user", content: "Question" },
        {
          id: "message_2",
          role: "assistant",
          content: "Answer",
          citations: [
            {
              chunkType: "text",
              score: 0.9,
              source: {
                documentId: "doc_1",
                sourceFileName: "report.pdf",
                sectionPath: "Results",
              },
            },
          ],
        },
      ],
    })
    expect(mocks.findChatThreadInWorkspace).toHaveBeenCalledWith(
      "workspace_1",
      "thread_1",
    )
    expect(mocks.listMessagesForThread).toHaveBeenCalledWith(
      "workspace_1",
      "thread_1",
    )
  })

  it("returns 404 when the thread is outside the current workspace", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" })
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" })
    mocks.findChatThreadInWorkspace.mockResolvedValue(null)

    const response = await GET(
      new NextRequest("http://localhost:3001/api/chat/threads/thread_other"),
      { params: Promise.resolve({ threadId: "thread_other" }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      message: "Chat thread not found.",
    })
    expect(mocks.listMessagesForThread).not.toHaveBeenCalled()
  })

  it("archives a chat thread without hard-deleting its messages", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" })
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" })
    mocks.softDeleteChatThread.mockResolvedValue(true)

    const response = await PATCH(
      new NextRequest("http://localhost:3001/api/chat/threads/thread_1", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
      { params: Promise.resolve({ threadId: "thread_1" }) },
    )

    await expect(response.json()).resolves.toEqual({
      id: "thread_1",
      archived: true,
    })
    expect(mocks.softDeleteChatThread).toHaveBeenCalledWith(
      "workspace_1",
      "thread_1",
    )
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

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "message_1",
    threadId: "thread_1",
    role: "user",
    content: "Message",
    citations: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    ...overrides,
  }
}
