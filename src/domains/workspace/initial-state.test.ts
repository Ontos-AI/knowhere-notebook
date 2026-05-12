import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { loadWorkspaceShellInitialState } from "./initial-state"
import type { AuthUser } from "@/infrastructure/auth"
import type { ChatThread, Source, Workspace } from "@/infrastructure/db/schema"
import type { DemoCatalog } from "@/integrations/knowhere-demo"

type InitialStateDependencies = NonNullable<
  Parameters<typeof loadWorkspaceShellInitialState>[0]
>
type InitialStateClient = Awaited<
  ReturnType<InitialStateDependencies["getClientForWorkspace"]>
>["client"]

describe("loadWorkspaceShellInitialState", () => {
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
        chunkCount: 70,
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
    expect(deps.reconcileSourcesForWorkspace).not.toHaveBeenCalled()
  })

  it("lists visible API demos before authenticated workspace sources", async () => {
    const workspace = makeWorkspace()
    const source = makeSource(workspace.id)
    const thread = makeThread(workspace.id)
    const deps = createDependencies({
      listChatThreads: vi.fn(async () => [thread]),
      reconcileSourcesForWorkspace: vi.fn(async () => [source]),
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
  })

  it("hides canonical demos that are hidden or already materialized", async () => {
    const workspace = makeWorkspace()
    const materializedSource = makeSource(workspace.id, {
      id: "source_demo",
      demoKey: "demo-tsla-q4-2025",
      title: "TSLA-Q4-2025-Update.pdf",
      knowhereDocumentId: "doc_user_copy",
    })
    const deps = createDependencies({
      listHiddenDemoSourceIds: vi.fn(async () => ["another-demo"]),
      reconcileSourcesForWorkspace: vi.fn(async () => [materializedSource]),
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(state.sources).toEqual([
      expect.objectContaining({
        id: "source_demo",
        kind: "workspace",
        documentId: "doc_user_copy",
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
      reconcileSourcesForWorkspace: vi.fn(async () => [legacyFakeSource]),
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
      reconcileSourcesForWorkspace: vi.fn(async () => [nonReadyLegacySource]),
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

  it("does not seed authenticated empty threads with non-persisted demo chat", async () => {
    const state = await loadWorkspaceShellInitialState(createDependencies())

    expect(state.activeChatThreadId).toBeNull()
    expect(state.chatMessages).toEqual([])
  })

  it("reconciles source state during authenticated shell load", async () => {
    const workspace = makeWorkspace()
    const readySource = makeSource(workspace.id, {
      status: "ready",
      knowhereDocumentId: "document_1",
    })
    const reconcileSourcesForWorkspace = vi.fn(async () => [readySource])
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
      reconcileSourcesForWorkspace,
    } satisfies InitialStateDependencies

    const state = await loadWorkspaceShellInitialState(deps)

    expect(reconcileSourcesForWorkspace).toHaveBeenCalledWith(
      workspace,
      expect.any(Object),
    )
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
    getClientForWorkspace: vi.fn(async () => ({ client })),
    getGuest: vi.fn(async () => ({ loginUrl: "/login" })),
    getOptionalAuthenticated: vi.fn(async () => ({ user, workspace })),
    listChatThreads: vi.fn(async () => []),
    listHiddenDemoSourceIds: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    reconcileSourcesForWorkspace: vi.fn(async () => []),
    sourceViewOptionsBySourceId: vi.fn(() => Effect.succeed(new Map())),
    ...overrides,
  }
}

function makeDemoCatalog(): DemoCatalog {
  return {
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

function makeThread(workspaceId: string): ChatThread {
  return {
    id: "thread_1",
    workspaceId,
    demoKey: null,
    title: "Revenue",
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
  }
}
