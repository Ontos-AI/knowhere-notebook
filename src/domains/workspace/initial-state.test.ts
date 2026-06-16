import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import { loadWorkspaceShellInitialState } from "./initial-state"
import type { AuthUser } from "@/infrastructure/auth"
import type {
  ChatMessage,
  ChatThread,
  Source,
  Workspace,
} from "@/infrastructure/db/schema"
import type { DemoCatalog } from "@/integrations/knowhere-demo"
import { formatUnknownForLog } from "@/lib/format-log-value"

type InitialStateDependencies = NonNullable<
  Parameters<typeof loadWorkspaceShellInitialState>[0]
>
type InitialStateClient = Awaited<
  ReturnType<InitialStateDependencies["getClientForWorkspace"]>
>["client"]

const originalDashboardOrigin = process.env.DASHBOARD_ORIGIN

describe("loadWorkspaceShellInitialState", () => {
  afterEach(() => {
    if (originalDashboardOrigin === undefined) {
      delete process.env.DASHBOARD_ORIGIN
      return
    }

    process.env.DASHBOARD_ORIGIN = originalDashboardOrigin
  })

  it("returns guest demo state from the Knowhere demo API only", async () => {
    const deps = createDependencies({
      getOptionalAuthenticated: vi.fn(async () => null),
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(state.isGuest).toBe(true)
    expect(state.sources).toEqual([
      {
        id: "demo-tsla-q4-2025",
        kind: "demo",
        demoSourceId: "demo-tsla-q4-2025",
        title: "TSLA-Q4-2025-Update.pdf",
        mimeType: "application/pdf",
        status: "ready",
        documentId: "demo-doc-tsla-q4-2025",
        originalFile: {
          url: "/api/demo-sources/demo-tsla-q4-2025/original",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          canDownload: false,
        },
        officialLibrary: {
          librarySourceId: "financial-tsla-q4-2025",
          categoryId: "financial-reports",
          sourceUrl: "https://example.com/tsla-q4-2025.pdf",
        },
        chunkCount: 70,
      },
    ])
    expect(state.officialLibrarySources).toEqual([
      {
        librarySourceId: "financial-tsla-q4-2025",
        categoryId: "financial-reports",
        categoryLabel: "Financial reports",
        title: "TSLA-Q4-2025-Update.pdf",
        sourceUrl: "https://example.com/tsla-q4-2025.pdf",
        mimeType: "application/pdf",
        status: "ready",
        demoSourceId: "demo-tsla-q4-2025",
        chunkCount: 70,
      },
      {
        librarySourceId: "stem-transformers",
        categoryId: "stem-books",
        categoryLabel: "STEM books",
        title: "Transformers.pdf",
        sourceUrl: "https://example.com/transformers.pdf",
        mimeType: "application/pdf",
        status: "planned",
      },
    ])
    expect(state.chatMessages).toEqual([
      {
        id: "demo-example-1-user",
        role: "user",
        content: "What happened in Tesla Q4?",
      },
      {
        id: "demo-example-1-assistant",
        role: "assistant",
        content: "Tesla delivered higher revenue.",
        citations: [
          {
            chunkType: "text",
            score: 0.95,
            content: "Automotive revenue increased.",
            source: {
              documentId: "demo-doc-tsla-q4-2025",
              sourceFileName: "TSLA-Q4-2025-Update.pdf",
              sectionPath: "Shareholder Deck",
            },
          },
        ],
      },
    ])
    expect(state.loginUrl).toBe("/login")
    expect(deps.listSourcesForWorkspace).not.toHaveBeenCalled()
  })

  it("exposes the configured Dashboard origin to the shell", async () => {
    process.env.DASHBOARD_ORIGIN = "https://dashboard.staging.example"

    const state = await loadWorkspaceShellInitialState(createDependencies())

    expect(state.dashboardUrl).toBe("https://dashboard.staging.example")
  })

  it("lists visible API demos before authenticated workspace sources", async () => {
    const workspace = makeWorkspace()
    const source = makeSource(workspace.id)
    const thread = makeThread(workspace.id)
    const deps = createDependencies({
      listChatThreads: vi.fn(async () => [thread]),
      listSourcesForWorkspace: vi.fn(async () => [source]),
      sourceViewOptionsBySourceId: vi.fn(() =>
        Effect.succeed(new Map([[source.id, { chunkCount: 2 }]])),
      ),
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(state.isGuest).toBeUndefined()
    expect(state.activeChatThreadId).toBe(thread.id)
    expect(state.sources).toEqual([
      expect.objectContaining({
        id: "demo-tsla-q4-2025",
        kind: "demo",
        demoSourceId: "demo-tsla-q4-2025",
      }),
      {
        id: source.id,
        kind: "workspace",
        title: "notes.pdf",
        mimeType: "application/pdf",
        status: "ready",
        documentId: "document_1",
        chunkCount: 2,
      },
    ])
    expect(deps.ensureDemoChatThread).not.toHaveBeenCalled()
  })

  it("keeps authenticated workspace sources when the demo catalog is unavailable", async () => {
    const workspace = makeWorkspace()
    const source = makeSource(workspace.id)
    const legacyFakeSource = makeSource(workspace.id, {
      id: "source_legacy_demo",
      demoKey: "demo-tsla-q4-2025",
      knowhereJobId: null,
      knowhereDocumentId: "demo-doc-tsla-q4-2025",
    })
    const sourceViewOptionsBySourceId = vi.fn(() =>
      Effect.succeed(new Map([[source.id, { chunkCount: 2 }]])),
    )
    const deps = createDependencies({
      fetchDemoCatalog: vi.fn(async () => {
        throw new Error("Demo API unavailable.")
      }),
      listSourcesForWorkspace: vi.fn(async () => [legacyFakeSource, source]),
      sourceViewOptionsBySourceId,
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(sourceViewOptionsBySourceId).toHaveBeenCalledWith(
      [source],
      expect.any(Object),
    )
    expect(state.sources).toEqual([
      {
        id: source.id,
        kind: "workspace",
        title: "notes.pdf",
        mimeType: "application/pdf",
        status: "ready",
        documentId: "document_1",
        chunkCount: 2,
      },
    ])
  })

  it("hides canonical demos that are hidden or already materialized", async () => {
    const workspace = makeWorkspace()
    const materializedSource = makeSource(workspace.id, {
      id: "source_demo",
      demoKey: "demo-tsla-q4-2025",
      title: "TSLA-Q4-2025-Update.pdf",
      knowhereDocumentId: "doc_user_copy",
    })
    const sourceViewOptionsBySourceId = vi.fn(() => Effect.succeed(new Map()))
    const deps = createDependencies({
      listHiddenDemoSourceIds: vi.fn(async () => ["another-demo"]),
      listSourcesForWorkspace: vi.fn(async () => [materializedSource]),
      sourceViewOptionsBySourceId,
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(sourceViewOptionsBySourceId).toHaveBeenCalledWith([], expect.any(Object))
    expect(state.sources).toEqual([
      expect.objectContaining({
        id: "source_demo",
        kind: "workspace",
        documentId: "doc_user_copy",
        chunkCount: 70,
      }),
    ])
  })

  it("does not treat legacy fake demo rows as materialized user copies", async () => {
    const workspace = makeWorkspace()
    const legacyFakeSource = makeSource(workspace.id, {
      id: "source_legacy_demo",
      demoKey: "demo-tsla-q4-2025",
      title: "TSLA-Q4-2025-Update.pdf",
      knowhereJobId: null,
      knowhereDocumentId: "demo-doc-tsla-q4-2025",
    })
    const sourceViewOptionsBySourceId = vi.fn(() => Effect.succeed(new Map()))
    const deps = createDependencies({
      listSourcesForWorkspace: vi.fn(async () => [legacyFakeSource]),
      sourceViewOptionsBySourceId,
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(sourceViewOptionsBySourceId).toHaveBeenCalledWith([], expect.any(Object))
    expect(state.sources).toEqual([
      expect.objectContaining({
        id: "demo-tsla-q4-2025",
        kind: "demo",
        demoSourceId: "demo-tsla-q4-2025",
        documentId: "demo-doc-tsla-q4-2025",
      }),
    ])
  })

  it("does not list non-ready legacy demo rows as workspace sources", async () => {
    const workspace = makeWorkspace()
    const nonReadyLegacySource = makeSource(workspace.id, {
      id: "source_non_ready_legacy_demo",
      status: "parsing",
      demoKey: "demo-tsla-q4-2025",
      knowhereJobId: null,
      knowhereDocumentId: null,
    })
    const sourceViewOptionsBySourceId = vi.fn(() => Effect.succeed(new Map()))
    const deps = createDependencies({
      listSourcesForWorkspace: vi.fn(async () => [nonReadyLegacySource]),
      sourceViewOptionsBySourceId,
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(sourceViewOptionsBySourceId).toHaveBeenCalledWith([], expect.any(Object))
    expect(state.sources).toEqual([
      expect.objectContaining({
        id: "demo-tsla-q4-2025",
        kind: "demo",
      }),
    ])
  })

  it("hides API-owned demos when deleted legacy rows were backfilled into visibility", async () => {
    const state = await loadWorkspaceShellInitialState(
      createDependencies({
        listHiddenDemoSourceIds: vi.fn(async () => ["demo-tsla-q4-2025"]),
      }),
    )

    expect(state.sources).toEqual([])
  })

  it("seeds authenticated empty workspaces with persisted demo chat", async () => {
    const workspace = makeWorkspace()
    const demoThread = makeThread(workspace.id, {
      id: "demo_thread_1",
      title: "What happened in Tesla Q4?",
      demoKey: "knowhere-demo-chat",
    })
    const demoMessages = [
      makeMessage(demoThread.id, {
        id: "demo_message_user",
        role: "user",
        content: "What happened in Tesla Q4?",
      }),
      makeMessage(demoThread.id, {
        id: "demo_message_assistant",
        role: "assistant",
        content: "Tesla delivered higher revenue.",
      }),
    ]
    const ensureDemoChatThread = vi.fn(async () => ({
      thread: demoThread,
      messages: demoMessages,
    }))
    const deps = createDependencies({
      getOptionalAuthenticated: vi.fn(async () => ({
        user: {
          id: "user_1",
          email: "ada@example.com",
          name: "Ada",
        },
        workspace,
      })),
      ensureDemoChatThread,
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(ensureDemoChatThread).toHaveBeenCalledWith(
      workspace.id,
      makeDemoCatalog(),
    )
    expect(state.activeChatThreadId).toBe("demo_thread_1")
    expect(state.chatThreads).toEqual([
      expect.objectContaining({
        id: "demo_thread_1",
        title: "What happened in Tesla Q4?",
      }),
    ])
    expect(state.chatMessages).toEqual([
      {
        id: "demo_message_user",
        role: "user",
        content: "What happened in Tesla Q4?",
        citations: undefined,
      },
      {
        id: "demo_message_assistant",
        role: "assistant",
        content: "Tesla delivered higher revenue.",
        citations: undefined,
      },
    ])
  })

  it("lists workspace sources without blocking on reconciliation", async () => {
    const workspace = makeWorkspace()
    const readySource = makeSource(workspace.id, {
      status: "ready",
      knowhereDocumentId: "document_1",
    })
    const listSourcesForWorkspace = vi.fn(async () => [readySource])
    const deps = {
      ...createDependencies({
        getOptionalAuthenticated: vi.fn(async () => ({
          user: {
            id: "user_1",
            email: "ada@example.com",
            name: "Ada",
          },
          workspace,
        })),
      }),
      listSourcesForWorkspace,
    } satisfies InitialStateDependencies

    const state = await loadWorkspaceShellInitialState(deps)

    expect(listSourcesForWorkspace).toHaveBeenCalledWith(workspace.id)
    expect(state.sources).toEqual([
      expect.objectContaining({
        id: "demo-tsla-q4-2025",
        kind: "demo",
      }),
      {
        id: readySource.id,
        kind: "workspace",
        title: "notes.pdf",
        mimeType: "application/pdf",
        status: "ready",
        documentId: "document_1",
      },
    ])
  })

  it("adds operation context when initial state loading fails", async () => {
    const deps = createDependencies({
      listSourcesForWorkspace: vi.fn(async () => {
        throw new Error("database connection refused")
      }),
    })

    try {
      await loadWorkspaceShellInitialState(deps)
      throw new Error("Expected initial state loading to fail.")
    } catch (error) {
      const formatted = formatUnknownForLog(error)

      expect(formatted).toContain("listSourcesForWorkspace")
      expect(formatted).toContain("database connection refused")
    }
  })

  it("adds operation context when chunk-count lookup fails", async () => {
    const deps = createDependencies({
      listSourcesForWorkspace: vi.fn(async () => [makeSource("workspace_1")]),
      sourceViewOptionsBySourceId: vi.fn(() =>
        Effect.die(new Error("Knowhere document list timed out")),
      ),
    })

    try {
      await loadWorkspaceShellInitialState(deps)
      throw new Error("Expected initial state loading to fail.")
    } catch (error) {
      const formatted = formatUnknownForLog(error)

      expect(formatted).toContain(
        "Workspace initial state sourceViewOptionsBySourceId failed",
      )
      expect(formatted).toContain("Knowhere document list timed out")
    }
  })
})

function createDependencies(
  overrides: Partial<InitialStateDependencies> = {},
): InitialStateDependencies {
  const workspace = makeWorkspace()
  const user: AuthUser = {
    id: "user_1",
    email: "ada@example.com",
    name: "Ada",
  }
  const client = {} as InitialStateClient

  return {
    fetchDemoCatalog: vi.fn(async () => makeDemoCatalog()),
    getClientForWorkspace: vi.fn(async () => ({ client, apiKey: "sk_test" })),
    getGuest: vi.fn(async () => ({ loginUrl: "/login" })),
    getOptionalAuthenticated: vi.fn(async () => ({ user, workspace })),
    ensureDemoChatThread: vi.fn(async () => null),
    listChatThreads: vi.fn(async () => []),
    listHiddenDemoSourceIds: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    listSourcesForWorkspace: vi.fn(async () => []),
    sourceViewOptionsBySourceId: vi.fn(() => Effect.succeed(new Map())),
    ...overrides,
  }
}

function makeDemoCatalog(): DemoCatalog {
  return {
    officialLibrary: {
      categories: [
        {
          categoryId: "financial-reports",
          label: "Financial reports",
          description: "Company filings.",
        },
        {
          categoryId: "stem-books",
          label: "STEM books",
          description: "Course materials.",
        },
      ],
      sources: [
        {
          librarySourceId: "financial-tsla-q4-2025",
          categoryId: "financial-reports",
          title: "TSLA-Q4-2025-Update.pdf",
          sourceUrl: "https://example.com/tsla-q4-2025.pdf",
          mimeType: "application/pdf",
          status: "ready",
          demoSourceId: "demo-tsla-q4-2025",
          canonicalDocumentId: "demo-doc-tsla-q4-2025",
          sizeBytes: 1024,
          chunkCount: 70,
        },
        {
          librarySourceId: "stem-transformers",
          categoryId: "stem-books",
          title: "Transformers.pdf",
          sourceUrl: "https://example.com/transformers.pdf",
          mimeType: "application/pdf",
          status: "planned",
        },
      ],
    },
    sources: [
      {
        demoSourceId: "demo-tsla-q4-2025",
        canonicalDocumentId: "demo-doc-tsla-q4-2025",
        title: "TSLA-Q4-2025-Update.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "ready",
        chunkCount: 70,
        originalFile: {
          url: "/api/v1/demo/sources/demo-tsla-q4-2025/original",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          canDownload: false,
        },
        officialLibrary: {
          librarySourceId: "financial-tsla-q4-2025",
          categoryId: "financial-reports",
          title: "TSLA-Q4-2025-Update.pdf",
          sourceUrl: "https://example.com/tsla-q4-2025.pdf",
          mimeType: "application/pdf",
          status: "ready",
          demoSourceId: "demo-tsla-q4-2025",
        },
        examples: [
          {
            id: "demo-example-1",
            question: "What happened in Tesla Q4?",
            answer: "Tesla delivered higher revenue.",
            citations: [
              {
                demoSourceId: "demo-tsla-q4-2025",
                canonicalDocumentId: "demo-doc-tsla-q4-2025",
                canonicalChunkId: "demo-chunk-1",
                chunkId: "parser-chunk-1",
                chunkType: "text",
                content: "Automotive revenue increased.",
                source: {
                  documentId: "demo-doc-tsla-q4-2025",
                  sourceFileName: "TSLA-Q4-2025-Update.pdf",
                  sectionPath: "Shareholder Deck",
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

function makeWorkspace(): Workspace {
  return {
    id: "workspace_1",
    userId: "user_1",
    namespace: "notebook-workspace_1",
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
  }
}

function makeSource(
  workspaceId: string,
  overrides: Partial<Source> = {},
): Source {
  return {
    id: "source_1",
    workspaceId,
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status: "ready",
    failureReason: null,
    knowhereJobId: "job_1",
    knowhereDocumentId: "document_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  }
}

function makeThread(
  workspaceId: string,
  overrides: Partial<ChatThread> = {},
): ChatThread {
  return {
    id: "thread_1",
    workspaceId,
    demoKey: null,
    title: "Revenue",
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    
    deletedAt: null,
    ...overrides,
  }
}

function makeMessage(
  threadId: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: "message_1",
    threadId,
    role: "user",
    content: "Hello",
    citations: null,
    artifacts: null,
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    ...overrides,
  }
}
