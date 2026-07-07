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
    failureStage: null,
    knowhereJobId: "job_1",
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

describe("countChunksBySourceId", () => {
  it("counts ready source chunks from the document total", async () => {
    const listChunks = vi.fn(async () => ({ pagination: { total: 12 } }))
    const readChunks = vi.fn(async () => ({
      chunks: [],
      totalChunks: 0,
    }))
    const mockClient = {
      documents: { listChunks },
      knowledge: { readChunks },
    } as unknown as Knowhere

    const { countChunksBySourceId } = await import("./counts")

    const counts = await Effect.runPromise(
      countChunksBySourceId(
        [
          makeSource({ id: "ready", knowhereDocumentId: "doc_ready" }),
          makeSource({
            id: "parsing",
            status: "parsing",
            knowhereDocumentId: null,
          }),
          makeSource({ id: "missing-doc", knowhereDocumentId: null }),
        ],
        mockClient,
      ),
    )

    expect(listChunks).toHaveBeenCalledTimes(1)
    expect(readChunks).toHaveBeenCalledWith({
      documentId: "doc_ready",
      revisionKey: "job_1",
      chunkType: "page",
      page: 1,
      pageSize: 1,
      assetUrlPolicy: "durable",
    })
    expect(listChunks).toHaveBeenCalledWith("doc_ready", {
      page: 1,
      pageSize: 1,
    })
    expect(counts).toEqual(new Map([["ready", 12]]))
  })

  it("skips a source count when the document total lookup fails", async () => {
    const listChunks = vi.fn(async () => {
      throw new Error("temporary outage")
    })
    const readChunks = vi.fn(async () => ({ chunks: [], totalChunks: 0 }))
    const mockClient = {
      documents: { listChunks },
      knowledge: { readChunks },
    } as unknown as Knowhere

    const { countChunksBySourceId } = await import("./counts")

    const counts = await Effect.runPromise(
      countChunksBySourceId(
        [makeSource({ id: "ready", knowhereDocumentId: "doc_ready" })],
        mockClient,
      ),
    )

    expect(counts.size).toBe(0)
    expect(listChunks).toHaveBeenCalledTimes(1)
  })

  it("does not count materialized demo sources through their copied document id", async () => {
    const listChunks = vi.fn().mockResolvedValue({
      pagination: { total: 70 },
    })
    const readChunks = vi.fn(async () => ({ chunks: [], totalChunks: 0 }))
    const mockClient = {
      documents: { listChunks },
      knowledge: { readChunks },
    } as unknown as Knowhere

    const { countChunksBySourceId } = await import("./counts")

    const counts = await Effect.runPromise(
      countChunksBySourceId(
        [
          makeSource({
            id: "source_demo",
            demoKey: "demo-tsla-q4-2025",
            knowhereDocumentId: "doc_user_copy",
          }),
        ],
        mockClient,
      ),
    )

    expect(listChunks).not.toHaveBeenCalled()
    expect(readChunks).not.toHaveBeenCalled()
    expect(counts.size).toBe(0)
  })
})

describe("sourceViewOptionsBySourceId", () => {
  it("detects page-asset documents from SDK page chunks", async () => {
    const listChunks = vi.fn(async () => ({ pagination: { total: 12 } }))
    const readChunks = vi.fn(async () => ({
      chunks: [
        {
          chunkId: "page_1",
          chunkType: "page",
          metadata: {
            pageAssets: [
              {
                pageNum: 1,
                artifactRef: "pages/page-000001.png",
                assetUrl: "https://assets.example/page-000001.png",
              },
            ],
          },
        },
      ],
      totalChunks: 4,
    }))
    const mockClient = {
      documents: { listChunks },
      knowledge: { readChunks },
    } as unknown as Knowhere

    const { sourceViewOptionsBySourceId } = await import("./counts")

    const options = await Effect.runPromise(
      sourceViewOptionsBySourceId(
        [makeSource({ id: "ready", knowhereDocumentId: "doc_ready" })],
        mockClient,
      ),
    )

    expect(options.get("ready")).toEqual({
      chunkCount: 4,
      documentPresentation: { kind: "page-assets", pageCount: 4 },
    })
    expect(listChunks).not.toHaveBeenCalled()
  })
})
