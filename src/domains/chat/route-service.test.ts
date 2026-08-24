import { Either } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage, ChatThread, Source, Workspace } from "@/infrastructure/db/schema"

const mocks = vi.hoisted(() => ({
  appendMessageToThread: vi.fn(),
  createChatThread: vi.fn(),
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
      client: {},
      knowledge: {},
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
        generateAnswer: mocks.generateAgenticOutputManifest,
        hardenChatAssetUrl: expect.any(Function),
        repository: expect.objectContaining({
          appendMessageToThread: expect.any(Function),
          ensureDefaultChatThread: expect.any(Function),
          findChatThreadInWorkspace: expect.any(Function),
          listMessagesForThread: expect.any(Function),
        }),
      }),
    )
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

  it("hardens image inspection assets before sending Notebook URLs to Gemini", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    const readySource = makeSource({
      status: "ready",
      knowhereDocumentId: "doc_identity",
      knowhereJobId: "job_1",
    })
    const rawUrl =
      "https://knowhere-storage.example/results/job_1/images/id-front.png?AWSAccessKeyId=test"
    const durableUrl =
      "https://fake.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_identity/job_1/images/id-front.png"
    mocks.parsedStorageWriteAsset.mockResolvedValue({ url: durableUrl })
    mocks.generateObject.mockResolvedValue({
      object: {
        analysis: `The card number is visible. ${durableUrl} ${rawUrl}`,
        pages: [],
      },
    })
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([readySource])
    mocks.handleChatTurn.mockImplementation(
      async (input: {
        readonly inspectImages?: (request: {
          readonly question: string
          readonly assets: readonly {
            readonly ref: string
            readonly label: string
            readonly assetUrl: string
            readonly source: {
              readonly documentId?: string | null
              readonly sourceFileName?: string | null
              readonly sectionPath?: string | null
            }
          }[]
        }) => Promise<{
          readonly analysis: string
          readonly inspected: readonly {
            readonly ref: string
            readonly label: string
          }[]
          readonly skipped: readonly {
            readonly ref: string
            readonly reason: string
          }[]
        }>
      }) => {
        const inspection = await input.inspectImages?.({
          question: "Read the ID card text.",
          assets: [
            {
              ref: "asset:r1:result:1",
              label: "identity.pdf / images/id-front.png / image",
              assetUrl: rawUrl,
              source: {
                documentId: "doc_identity",
                sourceFileName: "identity.pdf",
                sectionPath: "images/id-front.png",
              },
            },
          ],
        })
        expect(inspection).toEqual({
          analysis: "The card number is visible. [image URL hidden] [image URL hidden]",
          inspected: [
            {
              ref: "asset:r1:result:1",
              label: "identity.pdf / images/id-front.png / image",
            },
          ],
          skipped: [],
        })
        return Either.right({
          threadId: "thread_1",
          messages: [
            { id: "message_user", role: "user", content: "Inspect it" },
            { id: "message_assistant", role: "assistant", content: "Answer" },
          ],
        })
      },
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Inspect the ID card image" },
    })

    expect(result.status).toBe(200)
    expect(fetch).toHaveBeenCalledWith(rawUrl)
    expect(fetch).toHaveBeenCalledWith(durableUrl)
    expect(mocks.parsedStorageWriteAsset).toHaveBeenCalledWith({
      documentId: "doc_identity",
      revisionKey: "job_1",
      sourcePath: "images/id-front.png",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    })
    const generateInput = mocks.generateObject.mock.calls[0]?.[0]
    expect(generateInput).toMatchObject({
      model: "google/gemini-3-flash",
    })
    expect(JSON.stringify(generateInput)).not.toContain(
      "knowhere-storage.example",
    )
    const content = generateInput.messages[0].content
    const imagePart = content.find(
      (part: { readonly type: string }) => part.type === "image",
    )
    expect(imagePart.image).toEqual(new Uint8Array([1, 2, 3]))
    expect(imagePart.mediaType).toBe("image/png")
  })

  it("hardens materialized demo page assets for image inspection", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    const readySource = makeSource({
      title: "TSLA-Q4-2025-Update.pdf",
      demoKey: "demo-tsla-q4-2025",
      knowhereDocumentId: "doc_materialized_tesla",
      knowhereJobId: null,
    })
    const demoAssetUrl =
      "https://demo.example/api/v1/demo/sources/demo-tsla-q4-2025/assets/page_citation_assets/page-6.png"
    const durableUrl =
      "https://fake.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_materialized_tesla/doc_materialized_tesla/page_citation_assets/page-6.png"
    mocks.parsedStorageWriteAsset.mockResolvedValue({ url: durableUrl })
    mocks.generateObject.mockResolvedValue({
      object: {
        analysis: "The total production row is visible.",
        pages: [],
      },
    })
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([readySource])
    mocks.handleChatTurn.mockImplementation(
      async (input: {
        readonly inspectImages?: (request: {
          readonly question: string
          readonly assets: readonly {
            readonly ref: string
            readonly label: string
            readonly sourcePath?: string | null
            readonly source: {
              readonly documentId?: string | null
              readonly sourceFileName?: string | null
              readonly sectionPath?: string | null
            }
          }[]
        }) => Promise<{
          readonly analysis: string
          readonly inspected: readonly {
            readonly ref: string
            readonly label: string
          }[]
          readonly skipped: readonly {
            readonly ref: string
            readonly reason: string
          }[]
        }>
      }) => {
        const inspection = await input.inspectImages?.({
          question: "Locate total production.",
          assets: [
            {
              ref: "asset:r1:result:1",
              label:
                "TSLA-Q4-2025-Update.pdf / page_citation_assets/page-6.png",
              sourcePath: "page_citation_assets/page-6.png",
              source: {
                documentId: "doc_materialized_tesla",
                sourceFileName: "TSLA-Q4-2025-Update.pdf",
                sectionPath: "OPERATIONAL SUMMARY",
              },
            },
          ],
        })
        expect(inspection).toEqual({
          analysis: "The total production row is visible.",
          inspected: [
            {
              ref: "asset:r1:result:1",
              label:
                "TSLA-Q4-2025-Update.pdf / page_citation_assets/page-6.png",
            },
          ],
          skipped: [],
        })
        return Either.right({
          threadId: "thread_1",
          messages: [
            { id: "message_user", role: "user", content: "Inspect it" },
            { id: "message_assistant", role: "assistant", content: "Answer" },
          ],
        })
      },
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "What was Tesla total production?" },
    })

    expect(result.status).toBe(200)
    expect(mocks.parsedStorageGetAssetUrl).toHaveBeenCalledWith({
      documentId: "doc_materialized_tesla",
      revisionKey: "doc_materialized_tesla",
      sourcePath: "page_citation_assets/page-6.png",
    })
    expect(fetch).toHaveBeenCalledWith(demoAssetUrl)
    expect(fetch).toHaveBeenCalledWith(durableUrl)
    expect(mocks.parsedStorageWriteAsset).toHaveBeenCalledWith({
      documentId: "doc_materialized_tesla",
      revisionKey: "doc_materialized_tesla",
      sourcePath: "page_citation_assets/page-6.png",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    })
  })

  it("uses image inspection source paths for retrieved page assets", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    const readySource = makeSource({
      status: "ready",
      knowhereDocumentId: "doc_contract",
      knowhereJobId: "job_1",
    })
    const durableUrl =
      "https://fake.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_contract/job_1/page_citation_assets/page-8.png"
    mocks.parsedStorageGetAssetUrl.mockResolvedValue(durableUrl)
    mocks.generateObject.mockResolvedValue({
      object: {
        analysis: "The page states 5000 yuan per occurrence.",
        pages: [],
      },
    })
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([readySource])
    mocks.handleChatTurn.mockImplementation(
      async (input: {
        readonly inspectImages?: (request: {
          readonly question: string
          readonly assets: readonly {
            readonly ref: string
            readonly label: string
            readonly assetUrl?: string | null
            readonly sourcePath?: string | null
            readonly source: {
              readonly documentId?: string | null
              readonly sourceFileName?: string | null
              readonly sectionPath?: string | null
            }
          }[]
        }) => Promise<{
          readonly analysis: string
          readonly inspected: readonly {
            readonly ref: string
            readonly label: string
          }[]
          readonly skipped: readonly {
            readonly ref: string
            readonly reason: string
          }[]
        }>
      }) => {
        const inspection = await input.inspectImages?.({
          question: "Read the damages amount.",
          assets: [
            {
              ref: "asset:r1:referenced:1",
              label:
                "Root / （6）现场工期进度管理方面的违约责任 / page_citation_assets/page-8.png / page",
              sourcePath: "page_citation_assets/page-8.png",
              source: {
                documentId: "doc_contract",
                sourceFileName: "投标书.pdf",
                sectionPath: "Root / （6）现场工期进度管理方面的违约责任",
              },
            },
          ],
        })
        expect(inspection).toEqual({
          analysis: "The page states 5000 yuan per occurrence.",
          inspected: [
            {
              ref: "asset:r1:referenced:1",
              label:
                "Root / （6）现场工期进度管理方面的违约责任 / page_citation_assets/page-8.png / page",
            },
          ],
          skipped: [],
        })
        return Either.right({
          threadId: "thread_1",
          messages: [
            { id: "message_user", role: "user", content: "Inspect it" },
            { id: "message_assistant", role: "assistant", content: "Answer" },
          ],
        })
      },
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Inspect the clause page" },
    })

    expect(result.status).toBe(200)
    expect(mocks.parsedStorageGetAssetUrl).toHaveBeenCalledWith({
      documentId: "doc_contract",
      revisionKey: "job_1",
      sourcePath: "page_citation_assets/page-8.png",
    })
    expect(fetch).toHaveBeenCalledWith(durableUrl)
    expect(mocks.parsedStorageWriteAsset).not.toHaveBeenCalled()
    const generateInput = mocks.generateObject.mock.calls[0]?.[0]
    const content = generateInput.messages[0].content
    const imagePart = content.find(
      (part: { readonly type: string }) => part.type === "image",
    )
    expect(imagePart.image).toEqual(new Uint8Array([1, 2, 3]))
    expect(imagePart.mediaType).toBe("image/png")
  })

  it("hardens remote page inspection assets by document revision when no local source matches", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    const rawUrl =
      "https://knowhere-storage.example/results/job_remote/page_citation_assets/page-8.png?AWSAccessKeyId=test"
    const durableUrl =
      "https://fake.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_remote/job_remote/page_citation_assets/page-8.png"
    mocks.parsedStorageWriteAsset.mockResolvedValue({ url: durableUrl })
    mocks.generateObject.mockResolvedValue({
      object: {
        analysis: "The page states 5000 yuan per occurrence.",
        pages: [],
      },
    })
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([])
    mocks.handleChatTurn.mockImplementation(
      async (input: {
        readonly inspectImages?: (request: {
          readonly question: string
          readonly assets: readonly {
            readonly ref: string
            readonly label: string
            readonly assetUrl?: string | null
            readonly sourcePath?: string | null
            readonly revisionKey?: string | null
            readonly source: {
              readonly documentId?: string | null
              readonly sourceFileName?: string | null
              readonly sectionPath?: string | null
            }
          }[]
        }) => Promise<{
          readonly analysis: string
          readonly inspected: readonly {
            readonly ref: string
            readonly label: string
          }[]
          readonly skipped: readonly {
            readonly ref: string
            readonly reason: string
          }[]
        }>
      }) => {
        const inspection = await input.inspectImages?.({
          question: "Read the damages amount.",
          assets: [
            {
              ref: "asset:r1:referenced:5",
              label:
                "Root / （6）现场工期进度管理方面的违约责任 / page_citation_assets/page-8.png / page",
              assetUrl: rawUrl,
              sourcePath: "page_citation_assets/page-8.png",
              revisionKey: "job_remote",
              source: {
                documentId: "doc_remote",
                sourceFileName: null,
                sectionPath: "Root / （6）现场工期进度管理方面的违约责任",
              },
            },
          ],
        })
        expect(inspection).toEqual({
          analysis: "The page states 5000 yuan per occurrence.",
          inspected: [
            {
              ref: "asset:r1:referenced:5",
              label:
                "Root / （6）现场工期进度管理方面的违约责任 / page_citation_assets/page-8.png / page",
            },
          ],
          skipped: [],
        })
        return Either.right({
          threadId: "thread_1",
          messages: [
            { id: "message_user", role: "user", content: "Inspect it" },
            { id: "message_assistant", role: "assistant", content: "Answer" },
          ],
        })
      },
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Inspect the remote clause page" },
    })

    expect(result.status).toBe(200)
    expect(mocks.parsedStorageGetAssetUrl).toHaveBeenCalledWith({
      documentId: "doc_remote",
      revisionKey: "job_remote",
      sourcePath: "page_citation_assets/page-8.png",
    })
    expect(fetch).toHaveBeenCalledWith(rawUrl)
    expect(fetch).toHaveBeenCalledWith(durableUrl)
    expect(mocks.parsedStorageWriteAsset).toHaveBeenCalledWith({
      documentId: "doc_remote",
      revisionKey: "job_remote",
      sourcePath: "page_citation_assets/page-8.png",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    })
    const generateInput = mocks.generateObject.mock.calls[0]?.[0]
    expect(JSON.stringify(generateInput)).not.toContain(
      "knowhere-storage.example",
    )
    const content = generateInput.messages[0].content
    const imagePart = content.find(
      (part: { readonly type: string }) => part.type === "image",
    )
    expect(imagePart.image).toEqual(new Uint8Array([1, 2, 3]))
    expect(imagePart.mediaType).toBe("image/png")
  })

  it("skips unsupported or unavailable image inspection assets without failing chat", async () => {
    const workspace = makeWorkspace()
    const client = { retrieval: { query: vi.fn() } }
    const readySource = makeSource({
      status: "ready",
      knowhereDocumentId: "doc_identity",
      knowhereJobId: "job_1",
    })
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      user: { id: "user_1" },
      workspace,
      apiKey: "jwt_123",
      client,
    })
    mocks.listSourcesForWorkspace.mockResolvedValue([readySource])
    mocks.handleChatTurn.mockImplementation(
      async (input: {
        readonly inspectImages?: (request: {
          readonly question: string
          readonly assets: readonly {
            readonly ref: string
            readonly label: string
            readonly assetUrl: string
            readonly source: {
              readonly documentId?: string | null
              readonly sourceFileName?: string | null
              readonly sectionPath?: string | null
            }
          }[]
        }) => Promise<{
          readonly analysis: string
          readonly inspected: readonly {
            readonly ref: string
            readonly label: string
          }[]
          readonly skipped: readonly {
            readonly ref: string
            readonly reason: string
          }[]
        }>
      }) => {
        const inspection = await input.inspectImages?.({
          question: "Inspect these.",
          assets: [
            {
              ref: "asset:r1:result:1",
              label: "identity.pdf / images/animated.gif / image",
              assetUrl: "https://knowhere-storage.example/results/job_1/images/animated.gif",
              source: {
                documentId: "doc_identity",
                sourceFileName: "identity.pdf",
                sectionPath: "images/animated.gif",
              },
            },
            {
              ref: "asset:r1:result:2",
              label: "missing.pdf / images/missing.png / image",
              assetUrl: "https://knowhere-storage.example/results/job_2/images/missing.png",
              source: {
                documentId: "doc_missing",
                sourceFileName: "missing.pdf",
                sectionPath: "images/missing.png",
              },
            },
          ],
        })
        expect(inspection).toEqual({
          analysis: "",
          inspected: [],
          skipped: [
            {
              ref: "asset:r1:result:1",
              reason: "Only PNG, JPEG, and WebP image assets can be inspected.",
            },
            {
              ref: "asset:r1:result:2",
              reason: "No ready Notebook source matched the image asset.",
            },
          ],
        })
        return Either.right({
          threadId: "thread_1",
          messages: [
            { id: "message_user", role: "user", content: "Inspect it" },
            { id: "message_assistant", role: "assistant", content: "Answer" },
          ],
        })
      },
    )

    const result = await chatAnswerRouteService.answerChat({
      body: { message: "Inspect images" },
    })

    expect(result.status).toBe(200)
    expect(mocks.generateObject).not.toHaveBeenCalled()
    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
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
