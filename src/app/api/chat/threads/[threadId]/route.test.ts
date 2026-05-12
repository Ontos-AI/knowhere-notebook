import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  archiveThread: vi.fn(),
  getThread: vi.fn(),
}))

vi.mock("@/domains/chat/route-threads", () => ({
  chatThreadRouteService: {
    archiveThread: mocks.archiveThread,
    getThread: mocks.getThread,
  },
}))

import { GET, PATCH } from "./route"

describe("/api/chat/threads/[threadId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns a thread transcript from the chat route service", async () => {
    mocks.getThread.mockResolvedValue({
      status: 200,
      body: {
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
      },
    })

    const response = await GET(
      new NextRequest("http://localhost:3001/api/chat/threads/thread_1"),
      { params: Promise.resolve({ threadId: "thread_1" }) },
    )

    expect(response.status).toBe(200)
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
    expect(mocks.getThread).toHaveBeenCalledWith({ threadId: "thread_1" })
  })

  it("maps a missing thread service result to 404", async () => {
    mocks.getThread.mockResolvedValue({
      status: 404,
      body: { message: "Chat thread not found." },
    })

    const response = await GET(
      new NextRequest("http://localhost:3001/api/chat/threads/thread_other"),
      { params: Promise.resolve({ threadId: "thread_other" }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      message: "Chat thread not found.",
    })
  })

  it("passes archive requests to the chat route service", async () => {
    mocks.archiveThread.mockResolvedValue({
      status: 200,
      body: { id: "thread_1", archived: true },
    })

    const response = await PATCH(
      new NextRequest("http://localhost:3001/api/chat/threads/thread_1", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
      { params: Promise.resolve({ threadId: "thread_1" }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      id: "thread_1",
      archived: true,
    })
    expect(mocks.archiveThread).toHaveBeenCalledWith({
      threadId: "thread_1",
    })
  })

  it("returns 400 for an invalid JSON archive request body", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost:3001/api/chat/threads/thread_1", {
        method: "PATCH",
        body: "{",
      }),
      { params: Promise.resolve({ threadId: "thread_1" }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      message: "Invalid request body.",
    })
    expect(mocks.archiveThread).not.toHaveBeenCalled()
  })
})
