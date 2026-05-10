import { describe, expect, it, vi } from "vitest"

import type { Source, Workspace } from "./schema"

const workspace: Workspace = {
  id: "workspace_1",
  userId: "user_1",
  namespace: "notebook-workspace_1",
  createdAt: new Date("2026-05-06T00:00:00Z"),
}

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

async function loadReconcile({
  listSourcesForWorkspace,
  markSourceFailed = vi.fn(),
  markSourceReady = vi.fn(),
  saveSourceParseResult = vi.fn(),
  storeParsedResultAssets = vi.fn().mockResolvedValue({
    resultBlobUrl: "https://blob.example/result.zip",
    assetUrlsByFilePath: {},
  }),
}: {
  listSourcesForWorkspace: ReturnType<typeof vi.fn>
  markSourceFailed?: ReturnType<typeof vi.fn>
  markSourceReady?: ReturnType<typeof vi.fn>
  saveSourceParseResult?: ReturnType<typeof vi.fn>
  storeParsedResultAssets?: ReturnType<typeof vi.fn>
}): Promise<typeof import("./source-reconcile")> {
  vi.resetModules()
  vi.doMock("./workspace", () => ({
    listSourcesForWorkspace,
    markSourceFailed,
    markSourceReady,
    saveSourceParseResult,
    clearSourceStagedBlob: vi.fn(),
  }))
  vi.doMock("./parsed-result-assets", () => ({
    storeParsedResultAssets,
  }))
  return await import("./source-reconcile")
}

describe("reconcileSourcesForWorkspace", () => {
  it("marks completed parsing jobs ready when Knowhere publishes a document id", async () => {
    const parsing = makeSource({ id: "source_1", knowhereJobId: "job_1" })
    const ready = makeSource({
      id: "source_1",
      status: "ready",
      knowhereDocumentId: "doc_1",
    })
    const listSourcesForWorkspace = vi
      .fn()
      .mockResolvedValueOnce([parsing])
      .mockResolvedValueOnce([ready])
    const markSourceReady = vi.fn()
    const { reconcileSourcesForWorkspace } = await loadReconcile({
      listSourcesForWorkspace,
      markSourceReady,
    })

    const mockClient = {
      jobs: {
        get: vi.fn().mockResolvedValue({
          status: "done",
          documentId: "doc_1",
        }),
      },
    } as unknown as import("@ontos-ai/knowhere-sdk").default

    const result = await reconcileSourcesForWorkspace(workspace, mockClient)

    expect(markSourceReady).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
      "doc_1",
    )
    expect(result).toEqual([ready])
  })

  it("stores parsed result assets before marking a completed source ready", async () => {
    const parsing = makeSource({ id: "source_1", knowhereJobId: "job_1" })
    const ready = makeSource({
      id: "source_1",
      status: "ready",
      knowhereDocumentId: "doc_1",
    })
    const job = {
      status: "done",
      documentId: "doc_1",
      isDone: true,
    }
    const calls: string[] = []
    const listSourcesForWorkspace = vi
      .fn()
      .mockResolvedValueOnce([parsing])
      .mockResolvedValueOnce([ready])
    const markSourceReady = vi.fn(async () => {
      calls.push("ready")
    })
    const storeParsedResultAssets = vi.fn(async () => {
      calls.push("store")
      return {
        resultBlobUrl: "https://blob.example/result.zip",
        assetUrlsByFilePath: {
          "images/image-1.jpg": "https://blob.example/image-1.jpg",
        },
      }
    })
    const saveSourceParseResult = vi.fn(async () => {
      calls.push("save")
    })
    const { reconcileSourcesForWorkspace } = await loadReconcile({
      listSourcesForWorkspace,
      markSourceReady,
    })

    const mockClient = {
      jobs: {
        get: vi.fn().mockResolvedValue(job),
      },
    } as unknown as import("@ontos-ai/knowhere-sdk").default

    await reconcileSourcesForWorkspace(workspace, mockClient, {
      storeParsedResultAssets,
      saveSourceParseResult,
    })

    expect(storeParsedResultAssets).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      sourceId: "source_1",
      job,
      client: mockClient,
    })
    expect(saveSourceParseResult).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
      {
        resultBlobUrl: "https://blob.example/result.zip",
        assetUrlsByFilePath: {
          "images/image-1.jpg": "https://blob.example/image-1.jpg",
        },
      },
    )
    expect(calls).toEqual(["store", "save", "ready"])
  })

  it("keeps original public Blob uploads after completed URL parsing jobs", async () => {
    const parsing = makeSource({
      id: "source_1",
      knowhereJobId: "job_1",
      originalBlobPathname: "source-uploads/upload_1/document.pdf",
      originalBlobUrl:
        "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
    })
    const ready = makeSource({
      id: "source_1",
      status: "ready",
      knowhereDocumentId: "doc_1",
      originalBlobPathname: "source-uploads/upload_1/document.pdf",
      originalBlobUrl:
        "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
    })
    const listSourcesForWorkspace = vi
      .fn()
      .mockResolvedValueOnce([parsing])
      .mockResolvedValueOnce([ready])
    const deleteStagedSourceBlob = vi.fn()
    const clearSourceStagedBlob = vi.fn()
    const { reconcileSourcesForWorkspace } = await loadReconcile({
      listSourcesForWorkspace,
    })

    const mockClient = {
      jobs: {
        get: vi.fn().mockResolvedValue({
          status: "done",
          documentId: "doc_1",
          isDone: true,
        }),
      },
    } as unknown as import("@ontos-ai/knowhere-sdk").default

    await reconcileSourcesForWorkspace(workspace, mockClient, {
      deleteStagedSourceBlob,
      clearSourceStagedBlob,
    })

    expect(deleteStagedSourceBlob).not.toHaveBeenCalled()
    expect(clearSourceStagedBlob).not.toHaveBeenCalled()
  })

  it("marks failed parsing jobs failed with a user-safe reason", async () => {
    const parsing = makeSource({ id: "source_1", knowhereJobId: "job_1" })
    const failed = makeSource({
      id: "source_1",
      status: "failed",
      failureReason: "Parser rejected this document.",
    })
    const listSourcesForWorkspace = vi
      .fn()
      .mockResolvedValueOnce([parsing])
      .mockResolvedValueOnce([failed])
    const markSourceFailed = vi.fn()
    const { reconcileSourcesForWorkspace } = await loadReconcile({
      listSourcesForWorkspace,
      markSourceFailed,
    })

    const mockClient = {
      jobs: {
        get: vi.fn().mockResolvedValue({
          status: "failed",
          error: { message: "Parser rejected this document." },
        }),
      },
    } as unknown as import("@ontos-ai/knowhere-sdk").default

    await reconcileSourcesForWorkspace(workspace, mockClient)

    expect(markSourceFailed).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
      "Parser rejected this document.",
    )
  })

  it("leaves parsing rows unchanged on transient Knowhere lookup errors", async () => {
    const parsing = makeSource({ id: "source_1", knowhereJobId: "job_1" })
    const listSourcesForWorkspace = vi
      .fn()
      .mockResolvedValueOnce([parsing])
      .mockResolvedValueOnce([parsing])
    const markSourceReady = vi.fn()
    const markSourceFailed = vi.fn()
    const { reconcileSourcesForWorkspace } = await loadReconcile({
      listSourcesForWorkspace,
      markSourceReady,
      markSourceFailed,
    })

    const mockClient = {
      jobs: {
        get: vi.fn().mockRejectedValue(new Error("temporary outage")),
      },
    } as unknown as import("@ontos-ai/knowhere-sdk").default

    const result = await reconcileSourcesForWorkspace(workspace, mockClient)

    expect(markSourceReady).not.toHaveBeenCalled()
    expect(markSourceFailed).not.toHaveBeenCalled()
    expect(result).toEqual([parsing])
  })
})
