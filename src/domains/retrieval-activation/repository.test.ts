import { afterEach, describe, expect, it, vi } from "vitest"
import { Effect, Layer } from "effect"

import { retrievalActivationRepository } from "./repository"
import type { Db } from "@/infrastructure/db"

type InsertValues = {
  readonly workspaceId: string
  readonly unitType: string
  readonly unitRef: string
  readonly activationCount: number
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function runWithMockDb(insertValues: InsertValues[]) {
  const insertBuilder = {
    values: vi.fn((values: InsertValues[]) => {
      insertValues.push(...values)
      return insertBuilder
    }),
    onConflictDoUpdate: vi.fn(() => insertBuilder),
    returning: vi.fn(async () =>
      insertValues.map((_, index) => ({ id: `activation_${index}` })),
    ),
  }
  const dbMock = { insert: vi.fn(() => insertBuilder) }
  const { DbClient } = await vi.importActual<typeof import("@/infrastructure/db")>(
    "@/infrastructure/db",
  )
  const dbLayer = Layer.succeed(DbClient, dbMock as unknown as Db)
  return { dbLayer, insertBuilder, dbMock }
}

describe("retrievalActivationRepository.recordActivationsEffect", () => {
  it("does nothing and never touches the db for an empty batch", async () => {
    const insertValues: InsertValues[] = []
    const { dbLayer, dbMock } = await runWithMockDb(insertValues)

    const written = await Effect.runPromise(
      retrievalActivationRepository
        .recordActivationsEffect([])
        .pipe(Effect.provide(dbLayer)),
    )

    expect(written).toBe(0)
    expect(dbMock.insert).not.toHaveBeenCalled()
  })

  it("collapses duplicate unit refs into a single upsert row", async () => {
    const insertValues: InsertValues[] = []
    const { dbLayer, insertBuilder } = await runWithMockDb(insertValues)

    const written = await Effect.runPromise(
      retrievalActivationRepository
        .recordActivationsEffect([
          { workspaceId: "ws_1", unitType: "crystal_chunk", unitRef: "doc:chunk_1" },
          { workspaceId: "ws_1", unitType: "crystal_chunk", unitRef: "doc:chunk_1" },
          { workspaceId: "ws_1", unitType: "crystal_chunk", unitRef: "doc:chunk_2" },
        ])
        .pipe(Effect.provide(dbLayer)),
    )

    expect(written).toBe(2)
    expect(insertBuilder.values).toHaveBeenCalledOnce()
    expect(insertValues).toHaveLength(2)
    expect(insertValues.map((row) => row.unitRef).sort()).toEqual([
      "doc:chunk_1",
      "doc:chunk_2",
    ])
  })

  it("keeps the same unit ref distinct across different unit types and workspaces", async () => {
    const insertValues: InsertValues[] = []
    const { dbLayer } = await runWithMockDb(insertValues)

    await Effect.runPromise(
      retrievalActivationRepository
        .recordActivationsEffect([
          { workspaceId: "ws_1", unitType: "fluid_memory", unitRef: "item_1" },
          { workspaceId: "ws_1", unitType: "crystal_chunk", unitRef: "item_1" },
          { workspaceId: "ws_2", unitType: "fluid_memory", unitRef: "item_1" },
        ])
        .pipe(Effect.provide(dbLayer)),
    )

    expect(insertValues).toHaveLength(3)
  })
})

describe("retrievalActivationRepository.getActivationsEffect", () => {
  it("returns [] without querying the db for an empty unit ref list", async () => {
    const selectBuilder = { from: vi.fn(), where: vi.fn() }
    const dbMock = { select: vi.fn(() => selectBuilder) }
    const { DbClient } = await vi.importActual<typeof import("@/infrastructure/db")>(
      "@/infrastructure/db",
    )
    const dbLayer = Layer.succeed(DbClient, dbMock as unknown as Db)

    const result = await Effect.runPromise(
      retrievalActivationRepository
        .getActivationsEffect("ws_1", "fluid_memory", [])
        .pipe(Effect.provide(dbLayer)),
    )

    expect(result).toEqual([])
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it("returns matching activation rows", async () => {
    const rows = [
      {
        unitRef: "item_1",
        activationCount: 3,
        lastActivatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]
    const selectBuilder = {
      from: vi.fn(() => selectBuilder),
      where: vi.fn(async () => rows),
    }
    const dbMock = { select: vi.fn(() => selectBuilder) }
    const { DbClient } = await vi.importActual<typeof import("@/infrastructure/db")>(
      "@/infrastructure/db",
    )
    const dbLayer = Layer.succeed(DbClient, dbMock as unknown as Db)

    const result = await Effect.runPromise(
      retrievalActivationRepository
        .getActivationsEffect("ws_1", "fluid_memory", ["item_1", "item_2"])
        .pipe(Effect.provide(dbLayer)),
    )

    expect(result).toEqual(rows)
  })
})
