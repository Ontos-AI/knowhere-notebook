import { Either } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage, ChatThread, Source, Workspace } from "@/infrastructure/db/schema"

const mocks = vi.hoisted(() => ({
  appendMessageToThread: vi.fn(),
  createChatThread: vi.fn(),
  ensureDefaultChatThread: vi.fn(),
  findChatThreadInWorkspace: vi.fn(),
  generateAgenticOutputManifest: vi.fn(),
  getAuthenticated: vi.fn(),
  getAuthenticatedWithClient: vi.fn(),
  handleChatTurn: vi.fn(),
  listChatThreadsForWorkspace: vi.fn(),
  listMessagesForThread: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  listSourcesForWorkspace: vi.fn(),
  softDeleteChatThread: vi.fn(),
  startBackgroundReconciliation: vi.fn(),
}))

vi.mock("@/domains/chat", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domains/chat")>()
  return {
    ...original,
    generateAgenticOutputManifest: mocks.generateAgenticOutputManifest,
  }
})

vi.mock("@/domains/chat/service", () => ({
  handleChatTurn: mocks.handleChatTurn,
}))

vi.mock("@/domains/sources/background-reconcile", () => ({
  startBackgroundReconciliation: mocks.startBackgroundReconciliation,
}))

vi.mock("@/domains/sources/workflow-runtime", () => ({
  sourceWorkflowRuntime: {
    listForWorkspace: mocks.listSourcesForWorkspace,
  },
}))

vi.mock("@/domains/workspace/request-context", () => ({
  notebookRequestContext: {
    getAuthenticated: mocks.getAuthenticated,
    getAuthenticatedWithClient: mocks.getAuthenticatedWithClient,
  },
}))

vi.mock("@/domains/chat/thread-service", () => ({
  chatThreadService: {
    appendMessage: mocks.appendMessageToThread,
    create: mocks.createChatThread,
    ensureDefault: mocks.ensureDefaultChatThread,
    findInWorkspace: mocks.findChatThreadInWorkspace,
    listForWorkspace: mocks.listChatThreadsForWorkspace,
    listMessages: mocks.listMessagesForThread,
    softDelete: mocks.softDeleteChatThread,
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}))

import { chatAnswerRouteService } from "./route-answer"
import { chatThreadRouteService } from "./route-threads"

describe("chat route services", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("orchestrates a chat turn from request body to response body", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    const readySource = makeSource()
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([readySource])
    mocks.handleChatTurn.mockResolvedValue(
      Either.right({
        threadId: "thread_1",
        messages: [
          { id: "message_user", role: "user", content: "Summarize it" },
          { id: "message_assistant", role: "assistant", content: "Answer" },
        ],
      }),
    )

    const result = await chatAnswerRouteService.answerChat({
      body: {
        message: " Summarize it ",
        threadId: "thread_1",
        excludedSourceIds: ["source_skipped", null],
      },
    })

    expect(result).toEqual({
      status: 200,
      body: {
        threadId: "thread_1",
        messages: [
          { id: "message_user", role: "user", content: "Summarize it" },
          { id: "message_assistant", role: "assistant", content: "Answer" },
        ],
      },
    })
    expect(mocks.listSourcesForWorkspace).toHaveBeenCalledWith(workspace.id)
    expect(mocks.startBackgroundReconciliation).not.toHaveBeenCalled()
    expect(mocks.handleChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace,
        sources: [readySource],
        question: "Summarize it",
        threadId: "thread_1",
        excludedSourceIds: ["source_skipped"],
        retrieval: client.retrieval,
        generateAnswer: mocks.generateAgenticOutputManifest,
        loadSourceAssetUrls: expect.any(Function),
        repository: expect.objectContaining({
          appendMessageToThread: expect.any(Function),
          ensureDefaultChatThread: expect.any(Function),
          findChatThreadInWorkspace: expect.any(Function),
          listMessagesForThread: expect.any(Function),
        }),
      }),
    )
  })

  it("triggers background reconciliation for parsing sources without blocking chat", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    const parsingSource = makeSource({
      status: "parsing",
      knowhereDocumentId: null,
    })
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([parsingSource])
    mocks.startBackgroundReconciliation.mockResolvedValue(undefined)
    mocks.handleChatTurn.mockResolvedValue(
      Either.right({
        threadId: "thread_1",
        messages: [],
      }),
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Summarize it" },
    })

    expect(result.status).toBe(200)
    expect(mocks.startBackgroundReconciliation).toHaveBeenCalledWith(
      workspace.id,
      parsingSource.id,
      "jwt_123",
    )
    expect(mocks.handleChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [parsingSource],
      }),
    )
  })

  it("returns an explicit generation failure instead of a fake session error", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([makeSource()])
    mocks.handleChatTurn.mockRejectedValue(
      new Error("Gateway rejected tool schema: dataType enum invalid"),
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Summarize it" },
    })

    expect(result).toEqual({
      status: 502,
      body: {
        message:
          "Chat generation failed: Gateway rejected tool schema: dataType enum invalid",
      },
    })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "chat: answer failed",
      expect.objectContaining({
        status: 502,
        detail: "Gateway rejected tool schema: dataType enum invalid",
      }),
    )
  })

  it("returns an explicit authentication failure for auth-shaped chat errors", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([makeSource()])
    mocks.handleChatTurn.mockRejectedValue(
      new Error("HTTP 401: invalid API key"),
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Summarize it" },
    })

    expect(result).toEqual({
      status: 401,
      body: {
        message: "Chat authentication failed: HTTP 401: invalid API key",
      },
    })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "chat: answer failed",
      expect.objectContaining({
        status: 401,
        detail: "HTTP 401: invalid API key",
      }),
    )
  })

  it("lists chat threads as route-ready view data", async () => {
    mocks.getAuthenticated.mockResolvedValue({ workspace: makeWorkspace() })
    mocks.listChatThreadsForWorkspace.mockResolvedValue([
      makeThread({ id: "thread_2", title: "Second question" }),
      makeThread({ id: "thread_1", title: null }),
    ])

    const result = await chatThreadRouteService.listThreads()

    expect(result).toEqual({
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
    expect(mocks.listChatThreadsForWorkspace).toHaveBeenCalledWith(
      "workspace_1",
    )
  })

  it("creates a route-ready empty chat thread", async () => {
    mocks.getAuthenticated.mockResolvedValue({ workspace: makeWorkspace() })
    mocks.createChatThread.mockResolvedValue(
      makeThread({ id: "thread_new", title: null }),
    )

    const result = await chatThreadRouteService.createThread()

    expect(result).toEqual({
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
    expect(mocks.createChatThread).toHaveBeenCalledWith("workspace_1")
  })

  it("loads a route-ready thread transcript", async () => {
    mocks.getAuthenticated.mockResolvedValue({ workspace: makeWorkspace() })
    mocks.findChatThreadInWorkspace.mockResolvedValue(
      makeThread({ title: "Revenue" }),
    )
    mocks.listMessagesForThread.mockResolvedValue([
      makeMessage({ id: "message_1", role: "user", content: "Question" }),
      makeMessage({ id: "message_2", role: "assistant", content: "Answer" }),
    ])

    const result = await chatThreadRouteService.getThread({
      threadId: "thread_1",
    })

    expect(result).toEqual({
      status: 200,
      body: {
        thread: {
          id: "thread_1",
          title: "Revenue",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
        },
        messages: [
          {
            id: "message_1",
            role: "user",
            content: "Question",
            citations: undefined,
          },
          {
            id: "message_2",
            role: "assistant",
            content: "Answer",
            citations: undefined,
          },
        ],
      },
    })
  })

  it("archives a chat thread from a validated request body", async () => {
    mocks.getAuthenticated.mockResolvedValue({ workspace: makeWorkspace() })
    mocks.softDeleteChatThread.mockResolvedValue(true)

    const result = await chatThreadRouteService.archiveThread({
      threadId: "thread_1",
    })

    expect(result).toEqual({
      status: 200,
      body: { id: "thread_1", archived: true },
    })
    expect(mocks.softDeleteChatThread).toHaveBeenCalledWith(
      "workspace_1",
      "thread_1",
    )
  })
})

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace_1",
    userId: "user_1",
      activeKnowhereApiKeyId: null,
    namespace: "notebook-workspace_1",
    createdAt: new Date("2026-05-06T00:00:00Z"),
    ...overrides,
  }
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 100,
    status: "ready",
    failureReason: null,
    knowhereJobId: "job_123",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
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

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "message_1",
    threadId: "thread_1",
    role: "user",
    content: "Message",
    citations: null,
    artifacts: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    ...overrides,
  }
}
