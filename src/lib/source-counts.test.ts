import { describe, expect, it, vi } from "vitest";

import { Context, Layer } from "effect";

import type { Source } from "./schema";

function makeSource(overrides: Partial<Source>): Source {
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
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

async function loadSourceCounts(
  listChunks: ReturnType<typeof vi.fn>,
): Promise<typeof import("./source-counts")> {
  vi.resetModules();
  const tag = Context.GenericTag<unknown>("@knowhere/KnowhereClient");
  vi.doMock("./knowhere", () => ({
    KnowhereClient: tag,
    knowhereClientLayer: Layer.succeed(tag, {
      documents: { listChunks },
    }),
    getKnowhereClient: () => ({
      documents: { listChunks },
    }),
  }));
  return await import("./source-counts");
}

describe("countChunksBySourceId", () => {
  it("counts chunks only for ready sources with a Knowhere document id", async () => {
    const listChunks = vi.fn().mockResolvedValue({
      pagination: { total: 12 },
    });
    const { countChunksBySourceId } = await loadSourceCounts(listChunks);

    const counts = await countChunksBySourceId([
      makeSource({ id: "ready", knowhereDocumentId: "doc_ready" }),
      makeSource({ id: "parsing", status: "parsing", knowhereDocumentId: null }),
      makeSource({ id: "missing-doc", knowhereDocumentId: null }),
    ]);

    expect(listChunks).toHaveBeenCalledOnce();
    expect(listChunks).toHaveBeenCalledWith("doc_ready", {
      page: 1,
      pageSize: 1,
    });
    expect(counts).toEqual(new Map([["ready", 12]]));
  });

  it("skips a source count when Knowhere chunks lookup fails", async () => {
    const listChunks = vi.fn().mockRejectedValue(new Error("temporary outage"));
    const { countChunksBySourceId } = await loadSourceCounts(listChunks);

    const counts = await countChunksBySourceId([
      makeSource({ id: "ready", knowhereDocumentId: "doc_ready" }),
    ]);

    expect(counts.size).toBe(0);
  });
});
