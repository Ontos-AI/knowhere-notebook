import { describe, expect, it, vi } from "vitest";

import type { Source, Workspace } from "./schema";

const workspace: Workspace = {
  id: "workspace_1",
  userId: "user_1",
  namespace: "notebook-workspace_1",
  createdAt: new Date("2026-05-06T00:00:00Z"),
};

function makeSource(overrides: Partial<Source>): Source {
  return {
    id: "source_1",
    workspaceId: workspace.id,
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1,
    status: "parsing",
    failureReason: null,
    knowhereJobId: "job_1",
    knowhereDocumentId: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

async function loadReconcile({
  listSourcesForWorkspace,
  markSourceFailed = vi.fn(),
  markSourceReady = vi.fn(),
  jobsGet,
}: {
  listSourcesForWorkspace: ReturnType<typeof vi.fn>;
  markSourceFailed?: ReturnType<typeof vi.fn>;
  markSourceReady?: ReturnType<typeof vi.fn>;
  jobsGet: ReturnType<typeof vi.fn>;
}): Promise<typeof import("./source-reconcile")> {
  vi.resetModules();
  vi.doMock("./workspace", () => ({
    listSourcesForWorkspace,
    markSourceFailed,
    markSourceReady,
  }));
  vi.doMock("./knowhere", () => ({
    getKnowhereClient: () => ({
      jobs: {
        get: jobsGet,
      },
    }),
  }));
  return await import("./source-reconcile");
}

describe("reconcileSourcesForWorkspace", () => {
  it("marks completed parsing jobs ready when Knowhere publishes a document id", async () => {
    const parsing = makeSource({ id: "source_1", knowhereJobId: "job_1" });
    const ready = makeSource({
      id: "source_1",
      status: "ready",
      knowhereDocumentId: "doc_1",
    });
    const listSourcesForWorkspace = vi
      .fn()
      .mockResolvedValueOnce([parsing])
      .mockResolvedValueOnce([ready]);
    const markSourceReady = vi.fn();
    const { reconcileSourcesForWorkspace } = await loadReconcile({
      listSourcesForWorkspace,
      markSourceReady,
      jobsGet: vi.fn().mockResolvedValue({
        status: "done",
        documentId: "doc_1",
      }),
    });

    const result = await reconcileSourcesForWorkspace(workspace);

    expect(markSourceReady).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
      "doc_1",
    );
    expect(result).toEqual([ready]);
  });

  it("marks failed parsing jobs failed with a user-safe reason", async () => {
    const parsing = makeSource({ id: "source_1", knowhereJobId: "job_1" });
    const failed = makeSource({
      id: "source_1",
      status: "failed",
      failureReason: "Parser rejected this document.",
    });
    const listSourcesForWorkspace = vi
      .fn()
      .mockResolvedValueOnce([parsing])
      .mockResolvedValueOnce([failed]);
    const markSourceFailed = vi.fn();
    const { reconcileSourcesForWorkspace } = await loadReconcile({
      listSourcesForWorkspace,
      markSourceFailed,
      jobsGet: vi.fn().mockResolvedValue({
        status: "failed",
        error: { message: "Parser rejected this document." },
      }),
    });

    await reconcileSourcesForWorkspace(workspace);

    expect(markSourceFailed).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
      "Parser rejected this document.",
    );
  });

  it("leaves parsing rows unchanged on transient Knowhere lookup errors", async () => {
    const parsing = makeSource({ id: "source_1", knowhereJobId: "job_1" });
    const listSourcesForWorkspace = vi
      .fn()
      .mockResolvedValueOnce([parsing])
      .mockResolvedValueOnce([parsing]);
    const markSourceReady = vi.fn();
    const markSourceFailed = vi.fn();
    const { reconcileSourcesForWorkspace } = await loadReconcile({
      listSourcesForWorkspace,
      markSourceReady,
      markSourceFailed,
      jobsGet: vi.fn().mockRejectedValue(new Error("temporary outage")),
    });

    const result = await reconcileSourcesForWorkspace(workspace);

    expect(markSourceReady).not.toHaveBeenCalled();
    expect(markSourceFailed).not.toHaveBeenCalled();
    expect(result).toEqual([parsing]);
  });
});
