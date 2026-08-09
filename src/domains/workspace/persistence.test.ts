import { afterEach, describe, expect, it, vi } from "vitest"
import { Effect, Layer } from "effect"
import type { Db } from "@/infrastructure/db"
import { chatRepository } from "../chat/repository"

/**
 * Unit tests for `ensureWorkspace` with a mocked Drizzle client.
 *
 * At the unit level we care about call ordering and idempotency. Full
 * behavior against real Postgres — including soft-delete, cross-workspace
 * scoping, and cascade — is covered by `workspace.integration.test.ts`,
 * which runs only when `TEST_DATABASE_URL` is set.
 */

type Row = {
  id: string
  userId: string
  knowhereKeyLabel: string | null
  namespace: string
  createdAt: Date
}

type SelectBuilder = {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
}

type InsertBuilder = {
  values: ReturnType<typeof vi.fn>
  onConflictDoNothing: ReturnType<typeof vi.fn>
}

type DbMock = {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
}

type ChatThreadRow = {
  id: string
  workspaceId: string
  title: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

type ChatMessageInsert = {
  threadId: string
  role: "user" | "assistant"
  content: string
  citations: unknown
}

type ChatRepositoryDbMock = {
  select: ReturnType<typeof vi.fn>
  transaction: ReturnType<typeof vi.fn>
}

function buildDbMock(storage: { row: Row | null }): DbMock {
  // `select()` returns all columns; `select({ workspaceId })` (with a
  // columns object) is the workspace_members probe which should resolve to
  // an empty result set in these tests.
  function makeSelect(rows: () => unknown[]): SelectBuilder {
    const builder: SelectBuilder = {
      from: vi.fn(() => builder),
      // `where` must stay chainable (`where(...).orderBy(...)` in the real
      // query) yet also serve as the terminal for the members probe
      // (`select({...}).from(members).where(...)`).
      where: vi.fn(function (this: SelectBuilder) {
        const chainable = Object.assign(Promise.resolve(rows()), {
          orderBy: async () => rows(),
          limit: async () => rows(),
        })
        return chainable
      }),
      orderBy: vi.fn(async () => rows()),
      limit: vi.fn(async () => rows()),
    }
    return builder
  }
  function makeInsert(): InsertBuilder {
    const builder: InsertBuilder = {
      values: vi.fn(function (this: InsertBuilder, values: Row) {
        if (!storage.row) {
          storage.row = {
            id: crypto.randomUUID(),
            userId: values.userId,
            knowhereKeyLabel: values.knowhereKeyLabel ?? null,
            namespace: values.namespace,
            createdAt: new Date(),
          }
        }
        return builder
      }),
      onConflictDoNothing: vi.fn(async () => undefined),
    }
    return builder
  }
  return {
    select: vi.fn((columns?: unknown) =>
      columns
        ? makeSelect(() => [])
        : makeSelect(() => (storage.row ? [storage.row] : [])),
    ),
    insert: vi.fn(() => makeInsert()),
  }
}

async function loadWorkspaceService(dbMock: DbMock) {
  vi.resetModules()
  const { DbClient } = await vi.importActual<typeof import("@/infrastructure/db")>("@/infrastructure/db")
  const mockDbLayer = Layer.succeed(DbClient, dbMock as unknown as Db)
  vi.doMock("@/infrastructure/db", () => {
    const actual = vi.importActual<typeof import("@/infrastructure/db")>("@/infrastructure/db")
    return actual.then((m) => ({
      ...m,
      dbLayer: mockDbLayer,
    }))
  })
  return await import("./service")
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("workspaceService.ensureWorkspace", () => {
  it("returns the existing workspace on a warm call without inserting", async () => {
    const existing: Row = {
      id: "ws_1",
      userId: "user_1",
      knowhereKeyLabel: null,
      namespace: "notebook-existing",
      createdAt: new Date(),
    }
    const storage = { row: existing }
    const dbMock = buildDbMock(storage)

    const { workspaceService } = await loadWorkspaceService(dbMock)
    const got = await workspaceService.ensureWorkspace("user_1")

    expect(got).toEqual(existing)
    expect(dbMock.insert).not.toHaveBeenCalled()
  })

  it("returns null when the user has no workspace (no auto-create)", async () => {
    const storage: { row: Row | null } = { row: null }
    const dbMock = buildDbMock(storage)

    const { workspaceService } = await loadWorkspaceService(dbMock)
    const got = await workspaceService.ensureWorkspace("user_2")

    expect(got).toBeNull()
    expect(dbMock.insert).not.toHaveBeenCalled()
  })

  it("creates a workspace for a specific namespace", async () => {
    const storage: { row: Row | null } = { row: null }
    const dbMock = buildDbMock(storage)

    const { workspaceService } = await loadWorkspaceService(dbMock)
    const got = await workspaceService.ensureWorkspaceForNamespace(
      "user_1",
      "quarterly-reports",
    )

    expect(dbMock.insert).toHaveBeenCalledOnce()
    expect(got.userId).toBe("user_1")
    expect(got.namespace).toBe("quarterly-reports")
  })
})

describe("chatRepository", () => {
  it("strips retrieval content before persisting message citations", async () => {
    const insertedValues: ChatMessageInsert[] = []
    const thread: ChatThreadRow = {
      id: "thread_1",
      workspaceId: "workspace_1",
      title: "Grounded answer",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      deletedAt: null,
    }
    const insertedMessage = {
      id: "message_1",
      threadId: "thread_1",
      role: "assistant",
      content: "The answer is grounded.",
      citations: null,
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    }
    const selectBuilder = {
      from: vi.fn(() => selectBuilder),
      where: vi.fn(() => selectBuilder),
      limit: vi.fn(async () => [thread]),
    }
    const insertBuilder = {
      values: vi.fn((values: ChatMessageInsert) => {
        insertedValues.push(values)
        return insertBuilder
      }),
      returning: vi.fn(async () => [insertedMessage]),
    }
    const updateBuilder = {
      set: vi.fn(() => updateBuilder),
      where: vi.fn(async () => undefined),
    }
    const tx = {
      insert: vi.fn(() => insertBuilder),
      update: vi.fn(() => updateBuilder),
    }
    const dbMock: ChatRepositoryDbMock = {
      select: vi.fn(() => selectBuilder),
      transaction: vi.fn(async (callback) => callback(tx)),
    }
    const { DbClient } = await vi.importActual<typeof import("@/infrastructure/db")>("@/infrastructure/db")
    const dbLayer = Layer.succeed(DbClient, dbMock as unknown as Db)

    await Effect.runPromise(
      chatRepository
        .appendMessageToThreadEffect("workspace_1", {
          threadId: "thread_1",
          role: "assistant",
          content: "The answer is grounded.",
          citations: [
            {
              content: "retrieval text should not reach Postgres",
              chunkType: "text",
              score: 0.99,
              assetUrl: "https://assets.example/doc.pdf",
              description: "intro",
              source: {
                documentId: "doc_1",
                sourceFileName: "doc.pdf",
                sectionPath: "1. Introduction",
              },
            },
          ],
        })
        .pipe(Effect.provide(dbLayer)),
    )

    expect(insertedValues).toHaveLength(1)
    expect(insertedValues[0]!.citations).toEqual([
      {
        chunkType: "text",
        score: 0.99,
        assetUrl: "https://assets.example/doc.pdf",
        description: "intro",
        source: {
          documentId: "doc_1",
          sourceFileName: "doc.pdf",
          sectionPath: "1. Introduction",
        },
      },
    ])
  })
})
