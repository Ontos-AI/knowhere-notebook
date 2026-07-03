import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createParsedResultStorageAdapter: vi.fn(),
  loggerInfo: vi.fn(),
}))

vi.mock("./parse-result-storage-adapter", () => ({
  createParsedResultStorageAdapter: mocks.createParsedResultStorageAdapter,
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
  },
}))

import type { Source, SourceParseResult } from "@/infrastructure/db/schema"
import { syncRemoteParsedSnapshot } from "./remote-parsed-snapshot-sync"

describe("syncRemoteParsedSnapshot", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("caches an already-parsed remote document into the Notebook Blob snapshot", async () => {
    const storageAdapter = {
      adapter: {
        writeObject: vi.fn(),
      },
      keyPrefix:
        "workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result",
    }
    const listChunks = vi.fn(async () => ({
      jobResultId: "job_result_1",
    }))
    const cacheJobResult = vi.fn(async () => ({
      assetUrlsByFilePath: {
        "pages/page-1.png": "https://blob.example/pages/page-1.png",
      },
      parsedSnapshot: {
        manifestKey:
          "workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
        manifestUrl:
          "https://blob.example/workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
      },
    }))
    const repository = createRepository()
    mocks.createParsedResultStorageAdapter.mockReturnValue(storageAdapter)

    const snapshot = await syncRemoteParsedSnapshot({
      workspaceId: "workspace_1",
      source: makeSource({
        knowhereJobId: null,
      }),
      client: {
        documents: {
          listChunks,
        },
        knowledge: {
          cacheJobResult,
        },
      },
      repository,
    })

    expect(listChunks).toHaveBeenCalledWith("doc_remote", {
      page: 1,
      pageSize: 1,
      includeAssetUrls: false,
    })
    expect(mocks.createParsedResultStorageAdapter).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "00000000-0000-0000-0000-000000000009",
    })
    expect(cacheJobResult).toHaveBeenCalledWith({
      jobId: "job_result_1",
      storageAdapter,
    })
    expect(repository.markParsing).toHaveBeenCalledWith(
      "workspace_1",
      "00000000-0000-0000-0000-000000000009",
      "job_result_1",
      "doc_remote",
    )
    expect(repository.saveParseResult).toHaveBeenCalledWith(
      "workspace_1",
      "00000000-0000-0000-0000-000000000009",
      {
        resultBlobUrl:
          "https://blob.example/workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
        snapshotManifestUrl:
          "https://blob.example/workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
        snapshotManifestKey:
          "workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
        assetUrlsByFilePath: {
          "pages/page-1.png": "https://blob.example/pages/page-1.png",
        },
      },
    )
    expect(repository.markReady).toHaveBeenCalledWith(
      "workspace_1",
      "00000000-0000-0000-0000-000000000009",
      "doc_remote",
    )
    expect(snapshot).toEqual({
      resultBlobUrl:
        "https://blob.example/workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
      snapshotManifestUrl:
        "https://blob.example/workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
      snapshotManifestKey:
        "workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
      assetUrlsByFilePath: {
        "pages/page-1.png": "https://blob.example/pages/page-1.png",
      },
    })
  })

  it("returns the existing complete snapshot without calling Knowhere", async () => {
    const existingSnapshot = {
      resultBlobUrl:
        "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json",
      snapshotManifestUrl:
        "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json",
      snapshotManifestKey:
        "workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json",
      assetUrlsByFilePath: {},
    }
    const repository = createRepository({
      getParseSnapshotMetadata: vi.fn(async () => existingSnapshot),
    })
    const listChunks = vi.fn()
    const cacheJobResult = vi.fn()

    const snapshot = await syncRemoteParsedSnapshot({
      workspaceId: "workspace_1",
      source: makeSource(),
      client: {
        documents: {
          listChunks,
        },
        knowledge: {
          cacheJobResult,
        },
      },
      repository,
    })

    expect(snapshot).toEqual(existingSnapshot)
    expect(listChunks).not.toHaveBeenCalled()
    expect(cacheJobResult).not.toHaveBeenCalled()
    expect(repository.markParsing).not.toHaveBeenCalled()
    expect(repository.markReady).not.toHaveBeenCalled()
  })

  it("marks a parsing source ready when a complete snapshot already exists", async () => {
    const existingSnapshot = {
      resultBlobUrl:
        "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json",
      snapshotManifestUrl:
        "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json",
      snapshotManifestKey:
        "workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json",
      assetUrlsByFilePath: {},
    }
    const repository = createRepository({
      getParseSnapshotMetadata: vi.fn(async () => existingSnapshot),
    })
    const listChunks = vi.fn()
    const cacheJobResult = vi.fn()

    const snapshot = await syncRemoteParsedSnapshot({
      workspaceId: "workspace_1",
      source: makeSource({
        status: "parsing",
        knowhereDocumentId: "doc_remote",
      }),
      client: {
        documents: {
          listChunks,
        },
        knowledge: {
          cacheJobResult,
        },
      },
      repository,
    })

    expect(snapshot).toEqual(existingSnapshot)
    expect(listChunks).not.toHaveBeenCalled()
    expect(cacheJobResult).not.toHaveBeenCalled()
    expect(repository.markReady).toHaveBeenCalledWith(
      "workspace_1",
      "00000000-0000-0000-0000-000000000009",
      "doc_remote",
    )
  })

  it("retries an interrupted remote snapshot sync from a parsing source row", async () => {
    const storageAdapter = {
      adapter: {
        writeObject: vi.fn(),
      },
      keyPrefix:
        "workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result",
    }
    const listChunks = vi.fn()
    const cacheJobResult = vi.fn(async () => ({
      assetUrlsByFilePath: {},
      parsedSnapshot: {
        manifestKey:
          "workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
        manifestUrl:
          "https://blob.example/workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
      },
    }))
    const repository = createRepository()
    mocks.createParsedResultStorageAdapter.mockReturnValue(storageAdapter)

    await syncRemoteParsedSnapshot({
      workspaceId: "workspace_1",
      source: makeSource({
        status: "parsing",
        knowhereJobId: "job_result_1",
      }),
      client: {
        documents: {
          listChunks,
        },
        knowledge: {
          cacheJobResult,
        },
      },
      repository,
    })

    expect(listChunks).not.toHaveBeenCalled()
    expect(cacheJobResult).toHaveBeenCalledWith({
      jobId: "job_result_1",
      storageAdapter,
    })
    expect(repository.markReady).toHaveBeenCalledWith(
      "workspace_1",
      "00000000-0000-0000-0000-000000000009",
      "doc_remote",
    )
  })
})

type SyncRemoteParsedSnapshotInput = Parameters<
  typeof syncRemoteParsedSnapshot
>[0]

type TestRemoteParsedSnapshotRepository = NonNullable<
  SyncRemoteParsedSnapshotInput["repository"]
>

function createRepository(
  overrides: Partial<TestRemoteParsedSnapshotRepository> = {},
): TestRemoteParsedSnapshotRepository {
  return {
    ...createRepositoryShape(),
    ...overrides,
  }
}

function createRepositoryShape(): TestRemoteParsedSnapshotRepository {
  return {
    getParseSnapshotMetadata: vi.fn(async () => null),
    markParsing: vi.fn(async () => makeSource({ status: "parsing" })),
    markReady: vi.fn(async () => makeSource()),
    saveParseResult: vi.fn(async () => makeSourceParseResult()),
  }
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    workspaceId: "workspace_1",
    title: "remote.pdf",
    mimeType: "application/pdf",
    sizeBytes: 0,
    status: "ready",
    failureReason: null,
    knowhereJobId: "job_result_1",
    knowhereDocumentId: "doc_remote",
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

function makeSourceParseResult(
  overrides: Partial<SourceParseResult> = {},
): SourceParseResult {
  return {
    id: "parse_result_1",
    sourceId: "00000000-0000-0000-0000-000000000009",
    resultBlobUrl:
      "https://blob.example/workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
    snapshotManifestUrl:
      "https://blob.example/workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
    snapshotManifestKey:
      "workspaces/workspace_1/sources/00000000-0000-0000-0000-000000000009/parsed-result/manifest/current.json",
    assetUrls: {},
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    ...overrides,
  }
}
