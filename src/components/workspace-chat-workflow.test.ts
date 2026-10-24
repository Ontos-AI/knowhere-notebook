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
    vi.resetAllMocks()
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

  it("sends Chat messages with excluded Source ids and the current folder", async () => {
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
      currentFolderId: "folder_1",
      initialChatThreads: [],
      initialChatMessages: [],
      sources: [source, makeSource({ id: "source_included" })],
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
      folderId: "folder_1",
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

  it("sends directly with a shared demo even when the retired materialization API is unavailable", async () => {
    const demoSource = makeSource({
      id: "demo-tsla-q4-2025",
      kind: "demo",
      demoSourceId: "demo-tsla-q4-2025",
    })
    mocks.fetchChatThreads.mockResolvedValue([])
    mocks.materializeDemoSources.mockRejectedValue(new Error("Bad gateway"))
    mocks.sendChatMessage.mockResolvedValue({
      threadId: "thread_demo",
      messages: [{ id: "assistant_demo", role: "assistant", content: "Q4 answer" }],
    })

    const { result } = renderWorkspaceChatWorkflow({
      initialChatThreads: [],
      initialChatMessages: [],
      sources: [demoSource],
    })

    await act(async () => {
      await result.current.handleChatSend("What changed in Q4?", {
        useAgentic: true,
      })
    })

    expect(mocks.materializeDemoSources).not.toHaveBeenCalled()
    expect(mocks.sendChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "What changed in Q4?",
      excludedSourceIds: [],
    }))
    expect(result.current.chat.error).toBeNull()
    expect(result.current.chat.isSending).toBe(false)
  })

  it("does not send when every ready source is excluded", async () => {
    mocks.fetchChatThreads.mockResolvedValue([])
    const { result } = renderWorkspaceChatWorkflow({
      initialChatThreads: [], initialChatMessages: [],
      sources: [makeSource({ excludedFromQuery: true })],
    })
    await act(async () => {
      await result.current.handleChatSend("Summarize it", { useAgentic: true })
    })
    expect(mocks.sendChatMessage).not.toHaveBeenCalled()
    expect(result.current.chat.error).toBe("Add a ready source before asking questions.")
  })

  it("keeps historical citation sources separate from queryable sources", async () => {
    const historicalSource = makeSource({ id: "legacy-demo-copy", documentId: "old-private-doc" })
    mocks.fetchChatThreads.mockResolvedValue([])
    mocks.fetchChatThread.mockResolvedValue({
      requestedThreadId: "thread_history", thread: makeThread({ id: "thread_history" }),
      messages: [], citationSources: [historicalSource],
    })
    const { result } = renderWorkspaceChatWorkflow({
      initialChatThreads: [], initialChatMessages: [], sources: [],
    })
    await act(async () => result.current.handleSelectChatThread("thread_history"))
    await waitFor(() => {
      expect(result.current.citationSources).toEqual([historicalSource])
    })
  })

  it("retains earlier historical citation sources after sending another turn", async () => {
    const historicalSource = makeSource({ id: "legacy-copy", documentId: "legacy-doc" })
    const currentSource = makeSource({ id: "current-source", documentId: "current-doc" })
    mocks.fetchChatThreads.mockResolvedValue([])
    mocks.sendChatMessage.mockResolvedValue({ threadId: "thread_history", messages: [
      { id: "new-answer", role: "assistant", content: "New answer" },
    ], citationSources: [currentSource] })
    const { result } = renderWorkspaceChatWorkflow({
      activeChatThreadId: "thread_history", initialChatThreads: [makeThread({ id: "thread_history" })],
      initialChatMessages: [], initialCitationSources: [historicalSource], sources: [currentSource],
    })
    await act(async () => {
      await result.current.handleChatSend("Another question", { useAgentic: true })
    })
    expect(result.current.citationSources).toEqual([historicalSource, currentSource])
    await act(async () => result.current.handleSelectChatThread("another-thread"))
    await act(async () => result.current.handleSelectChatThread("thread_history"))
    expect(result.current.citationSources).toEqual([historicalSource, currentSource])
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
  readonly currentFolderId?: string | null
  readonly initialChatMessages: readonly []
  readonly initialChatThreads: readonly ChatThreadView[]
  readonly initialCitationSources?: readonly SourceView[]
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
