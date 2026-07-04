import { describe, expect, it, vi } from "vitest"

import { createRouteRetry } from "./route-retry"
import type { Source, Workspace } from "@/infrastructure/db/schema"

const workspace: Workspace = {
  id: "workspace_1",
  userId: "user_1",
  namespace: "notebook-workspace_1",
  createdAt: new Date("2026-05-10T00:00:00.000Z"),
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 5,
    status: "failed",
    failureReason: "boom",
    failureStage: null,
    knowhereJobId: "job_1",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  }
}

function baseDeps() {
  return {
    ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
    ensureWorkspace: vi.fn(async () => workspace),
    makeKnowhereClient: vi.fn(),
    requireUser: vi.fn(async () => ({ id: "user_1", email: null, name: null })),
    sourceService: {
      retrySourceToKnowhere: vi.fn(),
    },
  }
}

describe("createRouteRetry", () => {
  it("resumes parsed sync for a storage_sync failure without reparsing", async () => {
    const storageSyncFailed = makeSource({ failureStage: "storage_sync" })
    const resumedSource = makeSource({ status: "parsing", failureStage: null })
    const resumeParsedSync = vi.fn(async () => resumedSource)
    const deps = baseDeps()
    const retry = createRouteRetry({
      ...deps,
      resumeParsedSync,
      sourceService: {
        findInWorkspace: vi.fn(async () => storageSyncFailed),
        retrySourceToKnowhere: deps.sourceService.retrySourceToKnowhere,
      },
    } as unknown as Parameters<typeof createRouteRetry>[0])

    const result = await retry.retrySource({
      cookieHeader: "session=abc",
      sourceId: "source_1",
    })

    expect(result.status).toBe(200)
    expect(resumeParsedSync).toHaveBeenCalledWith({
      workspace,
      source: storageSyncFailed,
      apiKey: "jwt_123",
    })
    expect(deps.sourceService.retrySourceToKnowhere).not.toHaveBeenCalled()
  })

  it("reparses a plain parse failure with a saved original blob", async () => {
    const parseFailed = makeSource({
      failureStage: "parse",
      originalBlobUrl: "https://blob.example/source-uploads/u/document.pdf",
      originalBlobPathname: "source-uploads/u/document.pdf",
    })
    const parsingSource = makeSource({ status: "parsing", failureStage: null })
    const resumeParsedSync = vi.fn()
    const retrySourceToKnowhere = vi.fn(async () => parsingSource)
    const deps = baseDeps()
    const retry = createRouteRetry({
      ...deps,
      resumeParsedSync,
      makeKnowhereClient: vi.fn(() => ({})),
      sourceService: {
        findInWorkspace: vi.fn(async () => parseFailed),
        retrySourceToKnowhere,
      },
    } as unknown as Parameters<typeof createRouteRetry>[0])

    const result = await retry.retrySource({
      cookieHeader: "session=abc",
      sourceId: "source_1",
    })

    expect(result.status).toBe(200)
    expect(resumeParsedSync).not.toHaveBeenCalled()
    expect(retrySourceToKnowhere).toHaveBeenCalled()
  })
})
