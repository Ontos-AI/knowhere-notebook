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

  it("preserves active parsing job state when localizing an existing document", async () => {
    const conflictSet = await captureLocalizeConflictSet({
      title: "remote.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
    })

    expect(getSqlText(conflictSet.status)).toContain("CASE WHEN")
    expect(getSqlText(conflictSet.status)).toContain("knowhere_job_id")
    expect(getSqlText(conflictSet.knowhereJobId)).toContain("CASE WHEN")
    expect(getSqlText(conflictSet.knowhereJobId)).toContain(
      "knowhere_job_id",
    )
    expect(getSqlText(conflictSet.failureReason)).toContain("CASE WHEN")
  })

  it("preserves local metadata when remote document metadata is missing", async () => {
    const conflictSet = await captureLocalizeConflictSet({})

    expect(getSqlText(conflictSet.title)).toBe("title")
    expect(getSqlText(conflictSet.mimeType)).toBe("mime_type")
    expect(getSqlText(conflictSet.sizeBytes)).toBe("size_bytes")
  })
})

function makeThrowingDb(): Db {
  return {
    update: () => {
      throw new Error("database should not be called for demo source ids")
    },
  } as unknown as Db
}

async function captureLocalizeConflictSet(input: {
  readonly title?: string
  readonly mimeType?: string
  readonly sizeBytes?: number
}): Promise<Record<string, unknown>> {
  let conflictSet: Record<string, unknown> | null = null
  const returningSource = {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "remote.pdf",
    mimeType: "application/pdf",
    sizeBytes: 12,
    status: "ready",
    failureReason: null,
    knowhereJobId: null,
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    createdAt: new Date("2026-06-26T00:00:00Z"),
    updatedAt: new Date("2026-06-26T00:00:00Z"),
    deletedAt: null,
  }
  const db = {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: (config: { readonly set: Record<string, unknown> }) => {
          conflictSet = config.set
          return {
            returning: async () => [returningSource],
          }
        },
      }),
    }),
  } as unknown as Db

  await sourceRowRepository.localizeRemoteDocumentWithDb(db, "workspace_1", {
    documentId: "doc_1",
    status: "ready",
    ...input,
  })

  if (!conflictSet) {
    throw new Error("localizeRemoteDocumentWithDb did not configure conflict set")
  }

  return conflictSet
}

function getSqlText(value: unknown): string {
  const chunks = (value as { readonly queryChunks?: readonly unknown[] })
    .queryChunks
  return (chunks ?? []).map(getSqlChunkText).join("")
}

function getSqlChunkText(value: unknown): string {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return ""

  const sqlChunk = value as { readonly queryChunks?: readonly unknown[] }
  if (Array.isArray(sqlChunk.queryChunks)) {
    return sqlChunk.queryChunks.map(getSqlChunkText).join("")
  }

  const chunk = value as { readonly value?: readonly string[] }
  if (Array.isArray(chunk.value)) return chunk.value.join("")

  const column = value as { readonly name?: unknown }
  return typeof column.name === "string" ? column.name : ""
}
