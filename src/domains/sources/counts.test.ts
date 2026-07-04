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
    demoKey: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}

describe("countChunksBySourceId", () => {
  it("counts ready source chunks from the parsed snapshot manifest", async () => {
    const listChunks = vi.fn()
    const mockClient = {
      documents: { listChunks },
    } as unknown as Knowhere
    const repository = {
      getParseSnapshotMetadata: vi.fn(async (workspaceId: string, sourceId: string) =>
        sourceId === "ready"
          ? {
              resultBlobUrl: "https://blob.example/manifest/current.json",
              snapshotManifestUrl: "https://blob.example/manifest/current.json",
              snapshotManifestKey:
                "workspaces/workspace_1/sources/ready/parsed-result/manifest/current.json",
              assetUrlsByFilePath: {},
            }
          : null,
      ),
    }
    const readSnapshotManifest = vi.fn(async () => ({
      version: 1 as const,
      kind: "knowhere-parsed-result-snapshot" as const,
      jobId: "job_1",
      documentId: "doc_ready",
      sourceFileName: "notes.pdf",
      totalChunks: 12,
      chunkPageSize: 50,
      chunkPages: [],
      assetUrlsByFilePath: {},
      createdAt: "2026-07-04T00:00:00.000Z",
    }))

    const { countChunksBySourceId } = await import("./counts")

    const counts = await Effect.runPromise(
      countChunksBySourceId(
        [
          makeSource({ id: "ready", knowhereDocumentId: "doc_ready" }),
          makeSource({ id: "parsing", status: "parsing", knowhereDocumentId: null }),
          makeSource({ id: "missing-doc", knowhereDocumentId: null }),
        ],
        mockClient,
        {
          repository,
          readSnapshotManifest,
        },
      ),
    )

    expect(listChunks).not.toHaveBeenCalled()
    expect(repository.getParseSnapshotMetadata).toHaveBeenCalledWith(
      "workspace_1",
      "ready",
    )
    expect(readSnapshotManifest).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "ready",
      manifestKey:
        "workspaces/workspace_1/sources/ready/parsed-result/manifest/current.json",
    })
    expect(counts).toEqual(new Map([["ready", 12]]))
  })

  it("skips a source count when snapshot manifest lookup fails", async () => {
    const listChunks = vi.fn()
    const mockClient = {
      documents: { listChunks },
    } as unknown as Knowhere
    const repository = {
      getParseSnapshotMetadata: vi.fn(async () => ({
        resultBlobUrl: "https://blob.example/manifest/current.json",
        snapshotManifestUrl: "https://blob.example/manifest/current.json",
        snapshotManifestKey:
          "workspaces/workspace_1/sources/ready/parsed-result/manifest/current.json",
        assetUrlsByFilePath: {},
      })),
    }
    const readSnapshotManifest = vi.fn(async () => {
      throw new Error("temporary outage")
    })

    const { countChunksBySourceId } = await import("./counts")

    const counts = await Effect.runPromise(
      countChunksBySourceId(
        [makeSource({ id: "ready", knowhereDocumentId: "doc_ready" })],
        mockClient,
        {
          repository,
          readSnapshotManifest,
        },
      ),
    )

    expect(counts.size).toBe(0)
    expect(listChunks).not.toHaveBeenCalled()
  })

  it("does not count materialized demo sources through their copied document id", async () => {
    const listChunks = vi.fn().mockResolvedValue({
      pagination: { total: 70 },
    })
    const mockClient = {
      documents: { listChunks },
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
    expect(counts.size).toBe(0)
  })
})
