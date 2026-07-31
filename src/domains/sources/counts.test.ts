import { describe, expect, it, vi } from "vitest"
import { Effect } from "effect"

import type Knowhere from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1,
    status: "ready",
    failureReason: null,
    knowhereJobId: "job_1",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}

describe("countChunksBySourceId", () => {
  it("counts chunks only for ready sources with a Knowhere document id", async () => {
    const listChunks = vi.fn().mockResolvedValue({
      pagination: { total: 12 },
    })
    const mockClient = {
      documents: { listChunks },
    } as unknown as Knowhere

    const { countChunksBySourceId } = await import("./counts")

    const counts = await Effect.runPromise(
      countChunksBySourceId(
        [
          makeSource({ id: "ready", knowhereDocumentId: "doc_ready" }),
          makeSource({ id: "parsing", status: "parsing", knowhereDocumentId: null }),
          makeSource({ id: "missing-doc", knowhereDocumentId: null }),
        ],
        mockClient,
      ),
    )

    expect(listChunks).toHaveBeenCalledOnce()
    expect(listChunks).toHaveBeenCalledWith("doc_ready", {
      page: 1,
      pageSize: 1,
    })
    expect(counts).toEqual(new Map([["ready", 12]]))
  })

  it("skips a source count when Knowhere chunks lookup fails", async () => {
    const listChunks = vi.fn().mockRejectedValue(new Error("temporary outage"))
    const mockClient = {
      documents: { listChunks },
    } as unknown as Knowhere

    const { countChunksBySourceId } = await import("./counts")

    const counts = await Effect.runPromise(
      countChunksBySourceId(
        [makeSource({ id: "ready", knowhereDocumentId: "doc_ready" })],
        mockClient,
      ),
    )

    expect(counts.size).toBe(0)
  })
})
