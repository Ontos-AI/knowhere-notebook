import { describe, expect, it } from "vitest"
import { Effect } from "effect"

import { sourceRowRepository } from "./source-row-repository"
import { DbClient, type Db } from "@/infrastructure/db"

describe("sourceRowRepository", () => {
  it("classifies canonical demo ids as non-workspace source ids", () => {
    expect(sourceRowRepository.isWorkspaceSourceId("demo-tsla-q4-2025")).toBe(
      false,
    )
  })

  it("classifies UUIDs as workspace source ids", () => {
    expect(
      sourceRowRepository.isWorkspaceSourceId(
        "f03b2dd5-cbc6-44a1-a5cb-8106f8ce52bb",
      ),
    ).toBe(true)
  })

  it("does not update the database for canonical demo ids", async () => {
    const db = makeThrowingDb()

    await expect(
      sourceRowRepository.updateInWorkspaceWithDb(
        db,
        "workspace_1",
        "demo-tsla-q4-2025",
        { status: "ready" },
      ),
    ).resolves.toBeNull()
  })

  it("does not soft-delete the database for canonical demo ids", async () => {
    const db = makeThrowingDb()

    await expect(
      Effect.runPromise(
        sourceRowRepository
          .softDeleteEffect("workspace_1", "demo-tsla-q4-2025")
          .pipe(Effect.provideService(DbClient, db)),
      ),
    ).resolves.toBe(false)
  })
})

function makeThrowingDb(): Db {
  return {
    update: () => {
      throw new Error("database should not be called for demo source ids")
    },
  } as unknown as Db
}
