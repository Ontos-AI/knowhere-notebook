import { describe, expect, it } from "vitest"

import { workspaceShellClient } from "./workspace-shell-client"
import type { ChatMessageView, ChatThreadView } from "@/domains/chat/types"

describe("workspaceShellClient", () => {
  it("builds chunk page keys until the selected Source has no more pages", () => {
    expect(workspaceShellClient.getSourceChunksKey(null, 0, null)).toBeNull()

    expect(
      workspaceShellClient.getSourceChunksKey("source_1", 1, null),
    ).toEqual(["source-chunks", "source_1", 2])

    expect(
      workspaceShellClient.getSourceChunksKey("source_1", 1, {
        chunks: [],
        pagination: {
          page: 2,
          pageSize: 100,
          total: 200,
          totalPages: 2,
        },
      }),
    ).toBeNull()
  })

  it("recognizes loaded Chat Thread detail responses", () => {
    const thread: ChatThreadView = {
      id: "thread_1",
      title: "Revenue",
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    }
    const messages: ChatMessageView[] = [
      {
        id: "message_1",
        role: "user",
        content: "What changed?",
      },
    ]

    expect(
      workspaceShellClient.hasLoadedChatThreadData({
        requestedThreadId: thread.id,
        thread,
        messages,
      }),
    ).toBe(true)
    expect(
      workspaceShellClient.hasLoadedChatThreadData({
        requestedThreadId: thread.id,
        thread,
      }),
    ).toBe(false)
  })
})
