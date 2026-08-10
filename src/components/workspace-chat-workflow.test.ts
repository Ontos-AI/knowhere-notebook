// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatThreadView } from "@/domains/chat/types"
import type { SourceView } from "@/domains/sources/types"

const mocks = vi.hoisted(() => ({
  archiveChatThread: vi.fn(),
  createChatThread: vi.fn(),
  fetchChatThread: vi.fn(),
  fetchChatThreads: vi.fn(),
  materializeDemoSources: vi.fn(),
  sendChatMessage: vi.fn(),
}))

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    keys: {
      archiveChatThread: "archive-chat-thread",
      chat: "/api/chat",
      chatThreads: "/api/chat/threads",
    },
    archiveChatThread: mocks.archiveChatThread,
    createChatThread: mocks.createChatThread,
    fetchChatThread: mocks.fetchChatThread,
    fetchChatThreads: mocks.fetchChatThreads,
    materializeDemoSources: mocks.materializeDemoSources,
    sendChatMessage: mocks.sendChatMessage,
  },
}))

import { useWorkspaceChatWorkflow } from "./workspace-chat-workflow"

describe("useWorkspaceChatWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates a Chat Thread and makes it active without route knowledge in the caller", async () => {
    const thread = makeThread({ id: "thread_new", title: "New chat" })
    mocks.fetchChatThreads.mockResolvedValue([])
    mocks.createChatThread.mockResolvedValue({ thread, messages: [] })

    const { result } = renderWorkspaceChatWorkflow({
      initialChatThreads: [],
      initialChatMessages: [],
      sources: [],
    })

    await act(async () => {
      await result.current.handleCreateChatThread()
    })

    await waitFor(() => {
      expect(result.current.chat.threadId).toBe("thread_new")
    })
    expect(result.current.chatThreads).toEqual([thread])
  })

  it("sends Chat messages with excluded Source ids and updates the active thread", async () => {
    const source = makeSource({
      id: "source_excluded",
      excludedFromQuery: true,
    })
    mocks.fetchChatThreads.mockResolvedValue([])
    mocks.sendChatMessage.mockResolvedValue({
      threadId: "thread_1",
      messages: [
        {
          id: "message_assistant",
          role: "assistant",
          content: "Answer",
        },
      ],
    })

    const { result } = renderWorkspaceChatWorkflow({
      initialChatThreads: [],
      initialChatMessages: [],
      sources: [source],
    })

    await act(async () => {
      await result.current.handleChatSend("Summarize it", {
        useAgentic: true,
      })
    })

    expect(mocks.sendChatMessage).toHaveBeenCalledWith({
      message: "Summarize it",
      threadId: undefined,
      useAgentic: true,
      excludedSourceIds: ["source_excluded"],
    })
    await waitFor(() => {
      expect(result.current.chat.threadId).toBe("thread_1")
    })
    expect(result.current.chat.messages).toEqual([
      {
        id: "pending-1",
        role: "user",
        content: "Summarize it",
      },
      {
        id: "message_assistant",
        role: "assistant",
        content: "Answer",
      },
    ])
  })

  it("shows a retryable error without sending chat when demo materialization fails", async () => {
    const demoSource = makeSource({
      id: "demo-tsla-q4-2025",
      kind: "demo",
      demoSourceId: "demo-tsla-q4-2025",
    })
    const onSourcesMaterialized = vi.fn()
    mocks.fetchChatThreads.mockResolvedValue([])
    mocks.materializeDemoSources.mockRejectedValue(new Error("Bad gateway"))

    const { result } = renderWorkspaceChatWorkflow({
      initialChatThreads: [],
      initialChatMessages: [],
      onSourcesMaterialized,
      sources: [demoSource],
    })

    await act(async () => {
      await result.current.handleChatSend("What changed in Q4?", {
        useAgentic: true,
      })
    })

    expect(mocks.materializeDemoSources).toHaveBeenCalledWith({
      demoSourceIds: ["demo-tsla-q4-2025"],
    })
    expect(mocks.sendChatMessage).not.toHaveBeenCalled()
    expect(onSourcesMaterialized).not.toHaveBeenCalled()
    expect(result.current.chat.messages).toEqual([])
    expect(result.current.chat.error).toBe(
      "Demo sources could not be prepared right now.",
    )
    expect(result.current.chat.isSending).toBe(false)
  })

  it("blocks chat until Official Library demo sources are explicitly added", async () => {
    const librarySource = makeSource({
      id: "demo-spacex-s1",
      kind: "demo",
      demoSourceId: "demo-spacex-s1",
      officialLibrary: {
        librarySourceId: "financial-spacex-s1",
        categoryId: "financial-reports",
        sourceUrl: "https://example.com/spacex-s1.pdf",
      },
    })
    mocks.fetchChatThreads.mockResolvedValue([])
    mocks.sendChatMessage.mockResolvedValue({
      threadId: "thread_1",
      messages: [
        {
          id: "message_assistant",
          role: "assistant",
          content: "Answer",
        },
      ],
    })

    const { result } = renderWorkspaceChatWorkflow({
      initialChatThreads: [],
      initialChatMessages: [],
      sources: [librarySource],
    })

    await act(async () => {
      await result.current.handleChatSend("Summarize it", {
        useAgentic: true,
      })
    })

    expect(mocks.materializeDemoSources).not.toHaveBeenCalled()
    expect(mocks.sendChatMessage).not.toHaveBeenCalled()
    expect(result.current.chat.error).toBe(
      "Add a ready source before asking questions.",
    )
  })
})

function renderWorkspaceChatWorkflow(input: {
  readonly activeChatThreadId?: string | null
  readonly initialChatMessages: readonly []
  readonly initialChatThreads: readonly ChatThreadView[]
  readonly isGuest?: boolean
  readonly onSourcesMaterialized?: (
    demoSourceIds: readonly string[],
    materializedSources: readonly SourceView[],
  ) => void
  readonly sources: readonly SourceView[]
}) {
  return renderHook(() => useWorkspaceChatWorkflow(input), {
    wrapper: ({ children }: { readonly children: ReactNode }) =>
      createElement(
        SWRConfig,
        { value: { provider: () => new Map() } },
        children,
      ),
  })
}

function makeThread(overrides: Partial<ChatThreadView> = {}): ChatThreadView {
  return {
    id: "thread_1",
    title: "Thread",
    createdAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:00.000Z",
    ...overrides,
  }
}

function makeSource(overrides: Partial<SourceView> = {}): SourceView {
  return {
    id: "source_1",
    title: "Source",
    status: "ready",
    mimeType: "text/plain",
    excludedFromQuery: false,
    ...overrides,
  }
}
