import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import { loadWorkspaceShellInitialState } from "./initial-state"
import type { AuthUser } from "@/infrastructure/auth"
import type { Source, Workspace } from "@/infrastructure/db/schema"
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

  it("returns an empty unauthenticated state when no session is present", async () => {
    const deps = createDependencies({
      getCurrentUser: vi.fn(async () => null),
      getOptionalAuthenticated: vi.fn(async () => null),
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(state).toEqual({
      sources: [],
      workspaces: [],
      knowhereKeyLabels: [],
    })
    expect(deps.listSourcesForWorkspace).not.toHaveBeenCalled()
  })

  it("loads the workspace, sources, and key labels for an authenticated user", async () => {
    const state = await loadWorkspaceShellInitialState(createDependencies())

    expect(state.user?.id).toBe("user_1")
    expect(state.workspace).toEqual({
      id: "workspace_1",
      namespace: "notebook-workspace_1",
      activeKeyLabel: null,
    })
    expect(state.workspaces).toHaveLength(1)
    expect(state.knowhereKeyLabels).toEqual([
      { id: "key_1", label: "default", mask: "sk_te••••st" },
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
    expect(deps.reconcileSourcesForWorkspace).not.toHaveBeenCalled()
    expect(state.sources).toEqual([
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

  it("keeps matching Notebook uploads parsing while background reconciliation prepares artifacts", async () => {
    const workspace = makeWorkspace()
    const parsingSource = makeSource(workspace.id, {
      title: "uploaded.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      status: "parsing",
      knowhereJobId: "job_123",
      knowhereDocumentId: null,
    })
    const client = {
      documents: {
        list: vi
          .fn()
          .mockResolvedValueOnce({
            documents: [
              {
                documentId: "doc_uploaded",
                namespace: "default",
                status: "active",
                sourceFileName: "uploaded.pdf",
                documentMetadata: {
                  createdByClient: "notebook",
                  title: "uploaded.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 100,
                },
              },
            ],
          })
          .mockResolvedValueOnce({ documents: [] }),
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
      jobs: {
        get: vi.fn(),
        load: vi.fn(),
      },
    } as unknown as InitialStateClient
    const reconcileSourcesForWorkspace = vi.fn(async () => [parsingSource])
    const startBackgroundReconciliation = vi.fn(async () => undefined)
    const deps = createDependencies({
      getClientForWorkspace: vi.fn(async () => ({ client, apiKey: "sk_test" })),
      getOptionalAuthenticated: vi.fn(async () => ({
        user: {
          id: "user_1",
          email: "ada@example.com",
          name: "Ada",
        },
        workspace,
      })),
      listSourcesForWorkspace: vi.fn(async () => [parsingSource]),
      reconcileSourcesForWorkspace,
      startBackgroundReconciliation,
    })

    const state = await loadWorkspaceShellInitialState(deps)

    expect(reconcileSourcesForWorkspace).not.toHaveBeenCalled()
    expect(startBackgroundReconciliation).toHaveBeenCalledWith(
      workspace.id,
      parsingSource.id,
      "sk_test",
    )
    expect(state.sources).toEqual([
      {
        id: parsingSource.id,
        kind: "workspace",
        title: "uploaded.pdf",
        mimeType: "application/pdf",
        status: "parsing",
        documentId: undefined,
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
    getClientForWorkspace: vi.fn(async () => ({ client, apiKey: "sk_test" })),
    getCurrentUser: vi.fn(async () => user),
    getOptionalAuthenticated: vi.fn(async () => ({ user, workspace })),
    listChatThreads: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    listSourcesForWorkspace: vi.fn(async () => []),
    listWorkspacesForUser: vi.fn(async () => [workspace]),
    listMaskedKnowhereKeys: vi.fn(async () => [
      { id: "key_1", label: "default", mask: "sk_te••••st" },
    ]),
    localizeRemoteDocument: vi.fn(async () => makeSource("workspace_1")),
    reconcileSourcesForWorkspace: vi.fn(async () => []),
    sourceViewOptionsBySourceId: vi.fn(() => Effect.succeed(new Map())),
    ...overrides,
  }
}

function makeWorkspace(): Workspace {
  return {
    id: "workspace_1",
    userId: "user_1",
    activeKnowhereApiKeyId: null,
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
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  }
}
