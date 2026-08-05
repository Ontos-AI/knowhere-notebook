import { describe, expect, it, vi } from "vitest"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import type { Source, Workspace } from "@/infrastructure/db/schema"
import {
  markSourceReadyAfterReconciliation,
  pollSourceReconciliation,
} from "./source-reconcile-workflow"

const workspace: Workspace = {
  id: "workspace_1",
  userId: "user_1",
  activeKnowhereApiKeyId: null,
  namespace: "notebook-workspace_1",
  createdAt: new Date("2026-05-06T00:00:00Z"),
}

function makeSource(overrides: Partial<Source> = {}): Source {
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

function makeDoneJob(overrides: Partial<JobResult> = {}): JobResult {
  return {
    jobId: "job_1",
    status: "done",
    sourceType: "file",
    namespace: workspace.namespace,
    documentId: "doc_1",
    resultUrl: "https://knowhere.example/result.zip",
    createdAt: new Date("2026-05-06T00:00:00Z"),
    isDone: true,
    isFailed: false,
    isTerminal: true,
    ...overrides,
  }
}

function createRepository(source: Source | null = makeSource()) {
  return {
    findInWorkspace: vi.fn(async () => source),
    markFailed: vi.fn(async () => null),
    markReady: vi.fn(async () =>
      source ? { ...source, status: "ready" as const } : null,
    ),
    clearStagedBlob: vi.fn(async () => null),
  }
}

describe("pollSourceReconciliation", () => {
  it("leaves a completed Knowhere job parsing until artifacts can be prepared", async () => {
    const repository = createRepository()
    const client = {
      jobs: {
        get: vi.fn(async () => makeDoneJob()),
      },
    }

    const result = await pollSourceReconciliation({
      workspaceId: workspace.id,
      sourceId: "source_1",
      client,
      repository,
    })

    expect(result).toEqual({
      kind: "ready-to-prepare",
      jobId: "job_1",
      documentId: "doc_1",
    })
    expect(repository.markReady).not.toHaveBeenCalled()
    expect(repository.markFailed).not.toHaveBeenCalled()
  })

  it("marks failed Knowhere jobs failed and cleans staged uploads", async () => {
    const source = makeSource({
      stagedBlobPathname: "source-uploads/upload_1/document.pdf",
    })
    const repository = createRepository(source)
    const blobStore = {
      deleteStagedSourceBlob: vi.fn(async () => undefined),
    }
    const client = {
      jobs: {
        get: vi.fn(async () =>
          makeDoneJob({
            status: "failed",
            isDone: false,
            isFailed: true,
            error: {
              code: "parser_failed",
              message: "Parser rejected this document.",
              requestId: "request_1",
            },
          }),
        ),
      },
    }

    const result = await pollSourceReconciliation({
      workspaceId: workspace.id,
      sourceId: "source_1",
      client,
      repository,
      blobStore,
    })

    expect(result).toEqual({ kind: "resolved", status: "failed" })
    expect(repository.markFailed).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
      "Parser rejected this document.",
      "parsing",
    )
    expect(blobStore.deleteStagedSourceBlob).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
    )
    expect(repository.clearStagedBlob).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
    )
  })

  it("accepts done jobs without a result URL when a document id is published", async () => {
    const repository = createRepository()
    const jobWithoutResultUrl = makeDoneJob()
    delete jobWithoutResultUrl.resultUrl
    const client = {
      jobs: {
        get: vi.fn(async () => jobWithoutResultUrl),
      },
    }

    const result = await pollSourceReconciliation({
      workspaceId: workspace.id,
      sourceId: "source_1",
      client,
      repository,
    })

    expect(result).toEqual({
      kind: "ready-to-prepare",
      jobId: "job_1",
      documentId: "doc_1",
    })
    expect(repository.markFailed).not.toHaveBeenCalled()
  })
})

describe("markSourceReadyAfterReconciliation", () => {
  it("marks ready after Knowhere publishes a document id and cleans staged uploads", async () => {
    const source = makeSource({
      stagedBlobPathname: "source-uploads/upload_1/document.pdf",
    })
    const repository = createRepository(source)
    const blobStore = {
      deleteStagedSourceBlob: vi.fn(async () => undefined),
    }

    const result = await markSourceReadyAfterReconciliation({
      workspaceId: workspace.id,
      sourceId: "source_1",
      documentId: "doc_1",
      repository,
      blobStore,
    })

    expect(result).toEqual({ status: "ready" })
    expect(repository.markReady).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
      "doc_1",
    )
    expect(blobStore.deleteStagedSourceBlob).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
    )
    expect(repository.clearStagedBlob).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
    )
  })
})
