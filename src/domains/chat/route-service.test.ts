import { Either } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage, ChatThread, Source, Workspace } from "@/infrastructure/db/schema"

const mocks = vi.hoisted(() => ({
  appendMessageToThread: vi.fn(),
  createChatThread: vi.fn(),
  documentListChunks: vi.fn(),
  ensureDefaultChatThread: vi.fn(),
  findChatThreadInWorkspace: vi.fn(),
  generateAgenticOutputManifest: vi.fn(),
  generateObject: vi.fn(),
  generateText: vi.fn(),
  getAuthenticated: vi.fn(),
  getAuthenticatedWithClient: vi.fn(),
  handleChatTurn: vi.fn(),
  listChatThreadsForWorkspace: vi.fn(),
  listMessagesForThread: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  listSourcesForWorkspace: vi.fn(),
  makeKnowhereClientWithParsedStorage: vi.fn(),
  parsedStorageGetAssetUrl: vi.fn(),
  parsedStorageWriteAsset: vi.fn(),
  softDeleteChatThread: vi.fn(),
  startBackgroundReconciliation: vi.fn(),
  captureMemoryTurn: vi.fn(),
  recordActivations: vi.fn(),
}))

vi.mock("ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("ai")>()
  return {
    ...original,
    generateObject: mocks.generateObject,
    generateText: mocks.generateText,
  }
})

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClientWithParsedStorage: mocks.makeKnowhereClientWithParsedStorage,
}))

vi.mock("@/integrations/knowhere-demo", () => ({
  knowhereDemoApi: {
    resolveApiURL: (pathname: string) => `https://demo.example${pathname}`,
  },
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

vi.mock("@/integrations/memento/client", () => ({
  captureMemoryTurn: mocks.captureMemoryTurn,
  recordActivations: mocks.recordActivations,
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

vi.mock("@/domains/sources/parsed-document-blob-storage", () => ({
  BlobParsedDocumentStorage: vi.fn().mockImplementation(function () {
    return {
      getAssetUrl: mocks.parsedStorageGetAssetUrl,
      writeAsset: mocks.parsedStorageWriteAsset,
    }
  }),
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
    mocks.parsedStorageGetAssetUrl.mockResolvedValue(null)
    mocks.parsedStorageWriteAsset.mockResolvedValue({ url: null })
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: { documents: { listChunks: mocks.documentListChunks } },
      knowledge: {},
    })
    mocks.documentListChunks.mockResolvedValue({
      documentId: "doc_1",
      namespace: "default",
      chunks: [],
      pagination: { page: 1, pageSize: 200, total: 0, totalPages: 1 },
    })
    mocks.generateObject.mockResolvedValue({
      object: {
        analysis: "The image shows a chart.",
        pages: [],
      },
    })
    mocks.generateText.mockResolvedValue({ text: "The image shows a chart." })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
        useAgentic: true,
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
        useAgentic: true,
        excludedSourceIds: ["source_skipped"],
        retrieval: client.retrieval,
        generateAnswer: expect.any(Function),
        hardenChatAssetUrl: expect.any(Function),
        resolveConnectedAssets: expect.any(Function),
        readTableHtml: expect.any(Function),
        repository: expect.objectContaining({
          appendMessageToThread: expect.any(Function),
          ensureDefaultChatThread: expect.any(Function),
          findChatThreadInWorkspace: expect.any(Function),
          listMessagesForThread: expect.any(Function),
        }),
      }),
    )
  })

  it("injects a reader that returns the complete signed table HTML", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    const signedUrl = "https://knowhere-storage.example/tables/revenue.html?signature=valid"
    const tableHtml = "<table><tr><td>Q4</td><td>24.9</td></tr></table>"
    vi.stubGlobal("fetch", vi.fn(async () => new Response(tableHtml)))
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([makeSource()])
    mocks.handleChatTurn.mockImplementation(
      async (input: {
        readonly readTableHtml?: (assetUrl: string) => Promise<string>
      }) => {
        expect(await input.readTableHtml?.(signedUrl)).toBe(tableHtml)
        return Either.right({
          threadId: "thread_1",
          messages: [
            { id: "message_user", role: "user", content: "Read the table" },
            { id: "message_assistant", role: "assistant", content: "Answer" },
          ],
        })
      },
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Read the table" },
    })

    expect(result.status).toBe(200)
    expect(fetch).toHaveBeenCalledWith(signedUrl)
  })

  it("injects a resolver that matches connected assets by parser chunk id", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    mocks.documentListChunks.mockResolvedValue({
      documentId: "doc_1",
      namespace: "default",
      chunks: [
        {
          id: "dchk_1",
          chunkId: "parser_image_1",
          chunkType: "image",
          sortOrder: 1,
          metadata: {},
          assetUrl: "https://assets.example/image.jpg",
        },
      ],
      pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
    })
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([makeSource()])
    mocks.handleChatTurn.mockImplementation(
      async (input: {
        readonly resolveConnectedAssets?: (
          lookups: readonly {
            documentId: string
            chunkId: string
            type: "image" | "table"
          }[],
        ) => Promise<readonly unknown[]>
      }) => {
        expect(await input.resolveConnectedAssets?.([
          { documentId: "doc_1", chunkId: "parser_image_1", type: "image" },
        ])).toEqual([
          {
            documentId: "doc_1",
            chunkId: "parser_image_1",
            type: "image",
            assetUrl: "https://assets.example/image.jpg",
          },
        ])
        return Either.right({
          threadId: "thread_1",
          messages: [
            { id: "message_user", role: "user", content: "Show the image" },
            { id: "message_assistant", role: "assistant", content: "Answer" },
          ],
        })
      },
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Show the image" },
    })

    expect(result.status).toBe(200)
    expect(mocks.documentListChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 200,
      chunkType: "image",
      includeAssetUrls: true,
    })
  })

  it("hardens one chat asset through Notebook Blob for a ready source", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    const readySource = makeSource({
      status: "ready",
      knowhereDocumentId: "doc_legacy",
      knowhereJobId: "job_1",
    })
    const rawUrl = "https://knowhere-storage.example/results/job_1/pages/page-1.png"
    const durableUrl =
      "https://fake.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_legacy/job_1/pages/page-1.png"
    mocks.parsedStorageWriteAsset.mockResolvedValue({ url: durableUrl })
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([readySource])
    mocks.handleChatTurn.mockImplementation(
      async (input: {
        readonly hardenChatAssetUrl?: (assetInput: {
          readonly source: Source
          readonly sourcePath: string
          readonly assetUrl?: string | null
          readonly contentType?: string | null
        }) => Promise<string | null>
      }) => {
        const assetUrl = await input.hardenChatAssetUrl?.({
          source: readySource,
          sourcePath: "pages/page-1.png",
          assetUrl: rawUrl,
          contentType: "image/png",
        })
        expect(assetUrl).toBe(durableUrl)
        return Either.right({
          threadId: "thread_1",
          messages: [
            { id: "message_user", role: "user", content: "Show the page" },
            { id: "message_assistant", role: "assistant", content: "Answer" },
          ],
        })
      },
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Show the page" },
    })

    expect(result.status).toBe(200)
    expect(mocks.parsedStorageGetAssetUrl).toHaveBeenCalledWith({
      documentId: "doc_legacy",
      revisionKey: "job_1",
      sourcePath: "pages/page-1.png",
    })
    expect(fetch).toHaveBeenCalledWith(rawUrl)
    expect(mocks.parsedStorageWriteAsset).toHaveBeenCalledWith({
      documentId: "doc_legacy",
      revisionKey: "job_1",
      sourcePath: "pages/page-1.png",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    })
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
        messages: [
          { id: "message_user", role: "user", content: "Summarize it" },
          { id: "message_assistant", role: "assistant", content: "Summary" },
        ],
      }),
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Summarize it" },
    })

    expect(result.status).toBe(200)
    expect(mocks.captureMemoryTurn).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      sessionId: "thread_1",
      turns: [
        {
          userText: "Summarize it",
          assistantText: "Summary",
          sourceMessageId: "message_assistant",
          referencedDocumentIds: [],
        },
      ],
    })
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
    failureStage: null,
    knowhereJobId: "job_123",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    chunkCount: null,
    folderId: null,
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
    demoKey: null,
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
