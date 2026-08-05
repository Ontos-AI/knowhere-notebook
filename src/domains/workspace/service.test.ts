import { afterEach, describe, expect, it, vi } from "vitest"
import { Layer } from "effect"

import type { Db } from "@/infrastructure/db"

type WorkspaceRow = {
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
  limit: (limit: number) => Promise<WorkspaceRow[]>
}

type InsertBuilder = {
  values: ReturnType<typeof vi.fn>
  onConflictDoNothing: ReturnType<typeof vi.fn>
}

type WorkspaceDbMock = {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
}

function buildWorkspaceDbMock(storage: {
  row: WorkspaceRow | null
}): WorkspaceDbMock {
  function makeSelect(): SelectBuilder {
    const builder: SelectBuilder = {
      from: vi.fn(() => builder),
      where: vi.fn(function (this: SelectBuilder) {
        const chainable = Object.assign(Promise.resolve([]), {
          orderBy: async () => (storage.row ? [storage.row] : []),
          limit: async () => (storage.row ? [storage.row] : []),
        })
        return chainable
      }),
      orderBy: vi.fn(async () => (storage.row ? [storage.row] : [])),
      limit: vi.fn(async () => (storage.row ? [storage.row] : [])),
    }
    return builder
  }

  function makeInsert(): InsertBuilder {
    const builder: InsertBuilder = {
      values: vi.fn(function (this: InsertBuilder, values: WorkspaceRow) {
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
    select: vi.fn(() => makeSelect()),
    insert: vi.fn(() => makeInsert()),
  }
}

async function loadWorkspaceService(dbMock: WorkspaceDbMock) {
  vi.resetModules()
  const { DbClient } = await vi.importActual<typeof import("@/infrastructure/db")>("@/infrastructure/db")
  const mockDbLayer = Layer.succeed(DbClient, dbMock as unknown as Db)
  vi.doMock("@/infrastructure/db", () => {
    const actual = vi.importActual<typeof import("@/infrastructure/db")>("@/infrastructure/db")
    return actual.then((module) => ({
      ...module,
      dbLayer: mockDbLayer,
    }))
  })
  return await import("./service")
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("workspaceService", () => {
  it("returns null through the service seam when the user has no workspace", async () => {
    const storage: { row: WorkspaceRow | null } = { row: null }
    const dbMock = buildWorkspaceDbMock(storage)

    const { workspaceService } = await loadWorkspaceService(dbMock)
    const workspace = await workspaceService.ensureWorkspace("user_1")

    expect(workspace).toBeNull()
    expect(dbMock.insert).not.toHaveBeenCalled()
  })
})
