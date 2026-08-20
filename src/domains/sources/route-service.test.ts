import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { Job } from "@ontos-ai/knowhere-sdk";

import type { Source, Workspace } from "@/infrastructure/db/schema";
import { createRouteListing } from "./route-listing";
import { createSourceRouteService } from "./route-service";
import type { DemoCatalog } from "@/integrations/knowhere-demo";

const workspace: Workspace = {
  id: "workspace_1",
  userId: "user_1",
  namespace: "notebook-workspace_1",
  createdAt: new Date("2026-05-10T00:00:00Z"),
};

const source: Source = {
  id: "source_1",
  workspaceId: workspace.id,
  title: "notes.pdf",
  mimeType: "application/pdf",
  sizeBytes: 5,
  status: "parsing",
  failureReason: null,
  failureStage: null,
  knowhereJobId: "job_1",
  knowhereDocumentId: null,
  stagedBlobPathname: null,
  stagedBlobUrl: null,
  originalBlobPathname: null,
  originalBlobUrl: null,
  demoKey: null,
  createdAt: new Date("2026-05-10T00:00:00Z"),
  updatedAt: new Date("2026-05-10T00:00:00Z"),
  deletedAt: null,
};

const localizeNoRemoteDocuments = vi.fn(async () => source);

describe("source route service", () => {
  it("lists authenticated sources and triggers background reconciliation", async () => {
    const knowhereClient = {
      documents: {
        archive: vi.fn(async () => undefined),
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
      jobs: {
        create: vi.fn(),
        get: vi.fn(),
        upload: vi.fn(),
      },
    };
    const ensureApiKeyForWorkspace = vi.fn(async () => "jwt_123");
    const getSourceViewOptionsBySourceId = vi.fn(() =>
      Effect.succeed(new Map([[source.id, { chunkCount: 8 }]])),
    );
    const listSourcesForWorkspace = vi.fn(async () => [source]);
    const reconcileSourcesForWorkspace = vi.fn(async () => [source]);
    const startBackgroundReconciliation = vi.fn(async () => undefined);
    const listHiddenDemoSourceIds = vi.fn(async () => []);
    const listing = createRouteListing({
      demoApi: {
        fetchCatalog: vi.fn(async () => emptyDemoCatalog),
      },
      ensureApiKeyForWorkspace,
      ensureWorkspace: vi.fn(async () => workspace),
      getCurrentUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      getSourceViewOptionsBySourceId,
      makeKnowhereClient: vi.fn(() => knowhereClient),
      listSourcesForWorkspace,
      reconcileSourcesForWorkspace,
      startBackgroundReconciliation,
      sourceService: {
        listHiddenDemoSourceIds,
        localizeRemoteDocument: localizeNoRemoteDocuments,
      },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(result).toEqual({
      status: 200,
      body: {
        sources: [
          {
            id: "source_1",
            kind: "workspace",
            title: "notes.pdf",
            status: "parsing",
            mimeType: "application/pdf",
            documentId: undefined,
            chunkCount: 8,
          },
        ],
      },
    });
    expect(ensureApiKeyForWorkspace).toHaveBeenCalledWith(
      workspace.id,
      "session=abc",
    );
    expect(listSourcesForWorkspace).toHaveBeenCalledWith(workspace.id);
    expect(reconcileSourcesForWorkspace).not.toHaveBeenCalled();
    expect(startBackgroundReconciliation).toHaveBeenCalledWith(
      workspace.id,
      source.id,
      "jwt_123",
    );
    expect(listHiddenDemoSourceIds).toHaveBeenCalledWith(workspace.id);
  });

  it("returns processing without building a client when a source is not ready", async () => {
    const parsingSource: Source = {
      ...source,
      id: "00000000-0000-4000-8000-000000000002",
      knowhereDocumentId: "doc_legacy",
      knowhereJobId: null,
      status: "parsing",
    };
    const makeKnowhereClient = vi.fn();
    const service = createSourceRouteService({
      ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
      ensureWorkspace: vi.fn(async () => workspace),
      getCurrentUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      makeKnowhereClient,
      sourceService: {
        findInWorkspace: vi.fn(async () => parsingSource),
      },
    });

    const result = await service.loadSourceChunks({
      cookieHeader: "session=abc",
      sourceId: parsingSource.id,
      shouldLoadAll: false,
      pageParams: { page: 1, pageSize: 50 },
    });

    expect(result).toEqual({
      status: 202,
      body: {
        chunks: [],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 0,
          totalPages: 0,
        },
        message: "Source is still being prepared.",
      },
    });
  });

  it("lists shared default and legacy namespace documents as lightweight remote sources", async () => {
    const localReadySource: Source = {
      ...source,
      id: "source_ready",
      status: "ready",
      knowhereJobId: null,
      knowhereDocumentId: "doc_local",
    };
    const listDocuments = vi
      .fn()
      .mockResolvedValueOnce({
        documents: [
          {
            documentId: "doc_default",
            namespace: "default",
            status: "active",
            sourceFileName: "cli.pdf",
            documentMetadata: {
              createdByClient: "cli",
              mimeType: "application/pdf",
            },
          },
          {
            documentId: "doc_untagged",
            namespace: "default",
            status: "active",
            sourceFileName: "dummy.pdf",
          },
          {
            documentId: "doc_sdk",
            namespace: "default",
            status: "active",
            sourceFileName: "sdk.pdf",
            documentMetadata: {
              createdByClient: "node-sdk",
            },
          },
          {
            documentId: "doc_api",
            namespace: "default",
            status: "active",
            sourceFileName: "api.pdf",
            documentMetadata: {
              created_by_client: "api",
            },
          },
        ],
        pagination: {
          page: 1,
          page_size: 200,
          total: 2,
          total_pages: 2,
        },
      })
      .mockResolvedValueOnce({
        documents: [
          {
            documentId: "doc_local",
            namespace: "default",
            status: "active",
            sourceFileName: "local-duplicate.pdf",
          },
        ],
        pagination: {
          page: 2,
          pageSize: 200,
          total: 2,
          totalPages: 2,
        },
      })
      .mockResolvedValueOnce({
        documents: [
          {
            documentId: "doc_legacy",
            namespace: workspace.namespace,
            status: "active",
            sourceFileName: "legacy.pdf",
            documentMetadata: {
              createdByClient: "mcp",
            },
          },
        ],
        pagination: {
          page: 1,
          pageSize: 200,
          total: 1,
          totalPages: 1,
        },
      });
    const knowhereClient = {
      documents: {
        archive: vi.fn(async () => undefined),
        list: listDocuments,
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
      jobs: {
        create: vi.fn(),
        get: vi.fn(),
        upload: vi.fn(),
      },
    };
    const localizeRemoteDocument = vi.fn();
    const listing = createRouteListing({
      demoApi: {
        fetchCatalog: vi.fn(async () => emptyDemoCatalog),
      },
      ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
      ensureWorkspace: vi.fn(async () => workspace),
      getCurrentUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      getSourceViewOptionsBySourceId: vi.fn(() => Effect.succeed(new Map())),
      makeKnowhereClient: vi.fn(() => knowhereClient),
      listSourcesForWorkspace: vi.fn(async () => [localReadySource]),
      reconcileSourcesForWorkspace: vi.fn(async () => [localReadySource]),
      sourceService: {
        listHiddenDemoSourceIds: vi.fn(async () => []),
        localizeRemoteDocument,
      },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(listDocuments).toHaveBeenNthCalledWith(1, {
      namespace: "default",
      page: 1,
      pageSize: 200,
    });
    expect(listDocuments).toHaveBeenNthCalledWith(2, {
      namespace: "default",
      page: 2,
      pageSize: 200,
    });
    expect(listDocuments).toHaveBeenNthCalledWith(3, {
      namespace: workspace.namespace,
      page: 1,
      pageSize: 200,
    });
    expect(localizeRemoteDocument).not.toHaveBeenCalled();
    expect(result.body.sources).toEqual([
      expect.objectContaining({
        id: "source_ready",
        documentId: "doc_local",
        title: "notes.pdf",
        status: "ready",
      }),
      {
        id: "knowhere-doc:default:doc_default",
        kind: "remote",
        namespace: "default",
        title: "cli.pdf",
        mimeType: "application/pdf",
        status: "ready",
        documentId: "doc_default",
        excludedFromQuery: false,
      },
      {
        id: "knowhere-doc:notebook-workspace_1:doc_legacy",
        kind: "remote",
        namespace: workspace.namespace,
        title: "legacy.pdf",
        mimeType: "application/octet-stream",
        status: "ready",
        documentId: "doc_legacy",
        excludedFromQuery: false,
      },
    ]);
  });

  it("keeps matching Notebook uploads parsing until artifacts are ready", async () => {
    const parsingSource: Source = {
      ...source,
      id: "source_1",
      title: "uploaded.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      status: "parsing",
      knowhereJobId: "job_1",
      knowhereDocumentId: null,
    };
    const listDocuments = vi
      .fn()
      .mockResolvedValueOnce({
        documents: [
          {
            documentId: "doc_uploaded",
            namespace: "default",
            status: "active",
            sourceFileName: "uploaded.pdf",
            documentMetadata: {
              createdByClient: "notebook",
              title: "uploaded.pdf",
              mimeType: "application/pdf",
              sizeBytes: 100,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ documents: [] });
    const knowhereClient = {
      documents: {
        archive: vi.fn(async () => undefined),
        list: listDocuments,
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
      jobs: {
        create: vi.fn(),
        get: vi.fn(),
        upload: vi.fn(),
      },
    };
    const reconcileSourcesForWorkspace = vi.fn(async () => [parsingSource]);
    const localizeRemoteDocument = vi.fn(async () => parsingSource);
    const startBackgroundReconciliation = vi.fn(async () => undefined);
    const listing = createRouteListing({
      demoApi: {
        fetchCatalog: vi.fn(async () => emptyDemoCatalog),
      },
      ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
      ensureWorkspace: vi.fn(async () => workspace),
      getCurrentUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      getSourceViewOptionsBySourceId: vi.fn(() => Effect.succeed(new Map())),
      makeKnowhereClient: vi.fn(() => knowhereClient),
      listSourcesForWorkspace: vi.fn(async () => [parsingSource]),
      reconcileSourcesForWorkspace,
      startBackgroundReconciliation,
      sourceService: {
        listHiddenDemoSourceIds: vi.fn(async () => []),
        localizeRemoteDocument,
      },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(reconcileSourcesForWorkspace).not.toHaveBeenCalled();
    expect(startBackgroundReconciliation).toHaveBeenCalledWith(
      workspace.id,
      "source_1",
      "jwt_123",
    );
    expect(localizeRemoteDocument).not.toHaveBeenCalled();
    expect(result.body.sources).toEqual([
      expect.objectContaining({
        id: "source_1",
        title: "uploaded.pdf",
        status: "parsing",
        documentId: undefined,
      }),
    ]);
  });

  it("lists authenticated workspace sources when the demo catalog is unavailable", async () => {
    const legacyFakeSource: Source = {
      ...source,
      id: "source_legacy_demo",
      status: "ready",
      demoKey: "demo-tsla-q4-2025",
      knowhereJobId: null,
      knowhereDocumentId: "demo-doc-tsla-q4-2025",
    };
    const knowhereClient = {
      documents: {
        archive: vi.fn(async () => undefined),
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
      jobs: {
        create: vi.fn(),
        get: vi.fn(),
        upload: vi.fn(),
      },
    };
    const getSourceViewOptionsBySourceId = vi.fn(() =>
      Effect.succeed(new Map([[source.id, { chunkCount: 8 }]])),
    );
    const listing = createRouteListing({
      demoApi: {
        fetchCatalog: vi.fn(async () => {
          throw new Error("Demo API unavailable.");
        }),
      },
      ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
      ensureWorkspace: vi.fn(async () => workspace),
      getCurrentUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      getSourceViewOptionsBySourceId,
      makeKnowhereClient: vi.fn(() => knowhereClient),
      listSourcesForWorkspace: vi.fn(async () => [legacyFakeSource, source]),
      reconcileSourcesForWorkspace: vi.fn(async () => [
        legacyFakeSource,
        source,
      ]),
      sourceService: {
        listHiddenDemoSourceIds: vi.fn(async () => []),
        localizeRemoteDocument: localizeNoRemoteDocuments,
      },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(getSourceViewOptionsBySourceId).toHaveBeenCalledWith(
      [source],
      knowhereClient,
      expect.objectContaining({
        documentPresentationDetection: "disabled",
      }),
    );
    expect(result).toEqual({
      status: 200,
      body: {
        sources: [
          {
            id: "source_1",
            kind: "workspace",
            title: "notes.pdf",
            status: "parsing",
            mimeType: "application/pdf",
            documentId: undefined,
            chunkCount: 8,
          },
        ],
      },
    });
  });

  it("keeps API-owned demos visible when a legacy fake demo row exists", async () => {
    const legacyFakeSource: Source = {
      ...source,
      id: "source_legacy_demo",
      status: "ready",
      demoKey: "demo-tsla-q4-2025",
      knowhereJobId: null,
      knowhereDocumentId: "demo-doc-tsla-q4-2025",
    };
    const knowhereClient = {
      documents: {
        archive: vi.fn(async () => undefined),
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
      jobs: {
        create: vi.fn(),
        get: vi.fn(),
        upload: vi.fn(),
      },
    };
    const getSourceViewOptionsBySourceId = vi.fn(() => Effect.succeed(new Map()));
    const listing = createRouteListing({
      demoApi: {
        fetchCatalog: vi.fn(async () => demoCatalog),
      },
      ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
      ensureWorkspace: vi.fn(async () => workspace),
      getCurrentUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      getSourceViewOptionsBySourceId,
      makeKnowhereClient: vi.fn(() => knowhereClient),
      listSourcesForWorkspace: vi.fn(async () => [legacyFakeSource]),
      reconcileSourcesForWorkspace: vi.fn(async () => [legacyFakeSource]),
      sourceService: {
        listHiddenDemoSourceIds: vi.fn(async () => []),
        localizeRemoteDocument: localizeNoRemoteDocuments,
      },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(getSourceViewOptionsBySourceId).toHaveBeenCalledWith(
      [],
      knowhereClient,
      expect.objectContaining({
        documentPresentationDetection: "disabled",
      }),
    );
    expect(result).toEqual({
      status: 200,
      body: {
        sources: [
          {
            id: "demo-tsla-q4-2025",
            kind: "demo",
            demoSourceId: "demo-tsla-q4-2025",
            title: "TSLA-Q4-2025-Update.pdf",
            mimeType: "application/pdf",
            status: "ready",
            documentId: "demo-doc-tsla-q4-2025",
            originalFile: {
              url: "https://example.com/tsla-q4-2025.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1024,
              canDownload: false,
              pdfPreviewMode: "browser",
            },
            chunkCount: 70,
          },
        ],
      },
    });
  });

  it("keeps API-owned demos visible when a non-ready legacy demo row exists", async () => {
    const nonReadyLegacySource: Source = {
      ...source,
      id: "source_non_ready_legacy_demo",
      status: "parsing",
      demoKey: "demo-tsla-q4-2025",
      knowhereJobId: null,
      knowhereDocumentId: null,
    };
    const knowhereClient = {
      documents: {
        archive: vi.fn(async () => undefined),
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
      jobs: {
        create: vi.fn(),
        get: vi.fn(),
        upload: vi.fn(),
      },
    };
    const getSourceViewOptionsBySourceId = vi.fn(() => Effect.succeed(new Map()));
    const listing = createRouteListing({
      demoApi: {
        fetchCatalog: vi.fn(async () => demoCatalog),
      },
      ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
      ensureWorkspace: vi.fn(async () => workspace),
      getCurrentUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      getSourceViewOptionsBySourceId,
      makeKnowhereClient: vi.fn(() => knowhereClient),
      listSourcesForWorkspace: vi.fn(async () => [nonReadyLegacySource]),
      reconcileSourcesForWorkspace: vi.fn(async () => [nonReadyLegacySource]),
      sourceService: {
        listHiddenDemoSourceIds: vi.fn(async () => []),
        localizeRemoteDocument: localizeNoRemoteDocuments,
      },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(getSourceViewOptionsBySourceId).toHaveBeenCalledWith(
      [],
      knowhereClient,
      expect.objectContaining({
        documentPresentationDetection: "disabled",
      }),
    );
    expect(result).toEqual({
      status: 200,
      body: {
        sources: [
          expect.objectContaining({
            id: "demo-tsla-q4-2025",
            kind: "demo",
            demoSourceId: "demo-tsla-q4-2025",
          }),
        ],
      },
    });
  });

  it("uses demo catalog counts for materialized demo sources", async () => {
    const materializedSource: Source = {
      ...source,
      id: "source_demo",
      title: "TSLA-Q4-2025-Update.pdf",
      status: "ready",
      demoKey: "demo-tsla-q4-2025",
      knowhereJobId: null,
      knowhereDocumentId: "doc_user_copy",
      originalBlobUrl: "/api/demo-sources/demo-tsla-q4-2025/original",
    };
    const knowhereClient = {
      documents: {
        archive: vi.fn(async () => undefined),
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
      jobs: {
        create: vi.fn(),
        get: vi.fn(),
        upload: vi.fn(),
      },
    };
    const getSourceViewOptionsBySourceId = vi.fn(() => Effect.succeed(new Map()));
    const listing = createRouteListing({
      demoApi: {
        fetchCatalog: vi.fn(async () => demoCatalog),
      },
      ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
      ensureWorkspace: vi.fn(async () => workspace),
      getCurrentUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      getSourceViewOptionsBySourceId,
      makeKnowhereClient: vi.fn(() => knowhereClient),
      listSourcesForWorkspace: vi.fn(async () => [materializedSource]),
      reconcileSourcesForWorkspace: vi.fn(async () => [materializedSource]),
      sourceService: {
        listHiddenDemoSourceIds: vi.fn(async () => []),
        localizeRemoteDocument: localizeNoRemoteDocuments,
      },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(getSourceViewOptionsBySourceId).toHaveBeenCalledWith(
      [],
      knowhereClient,
      expect.objectContaining({
        documentPresentationDetection: "disabled",
      }),
    );
    expect(knowhereClient.documents.listChunks).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 200,
      body: {
        sources: [
          expect.objectContaining({
            id: "source_demo",
            kind: "workspace",
            demoSourceId: "demo-tsla-q4-2025",
            documentId: "doc_user_copy",
            chunkCount: 70,
          }),
        ],
      },
    });
  });

  it("lists API-owned demo sources for anonymous users", async () => {
    const ensureWorkspace = vi.fn(async () => workspace);
    const service = createSourceRouteService({
      demoApi: {
        fetchCatalog: vi.fn(async () => demoCatalog),
      },
      ensureWorkspace,
      getCurrentUser: vi.fn(async () => null),
    });

    const result = await service.listSources({ cookieHeader: "" });

    expect(result).toEqual({
      status: 200,
      body: {
        sources: [
          {
            id: "demo-tsla-q4-2025",
            kind: "demo",
            demoSourceId: "demo-tsla-q4-2025",
            title: "TSLA-Q4-2025-Update.pdf",
            mimeType: "application/pdf",
            status: "ready",
            documentId: "demo-doc-tsla-q4-2025",
            originalFile: {
              url: "https://example.com/tsla-q4-2025.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1024,
              canDownload: false,
              pdfPreviewMode: "browser",
            },
            chunkCount: 70,
          },
        ],
      },
    });
    expect(ensureWorkspace).not.toHaveBeenCalled();
  });

  it("uploads a parsed multipart file through the source workflow", async () => {
    const knowhereJob: Job = {
      jobId: "job_1",
      status: "waiting-file",
      sourceType: "file",
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    const knowhereClient = {
      jobs: {
        create: vi.fn(async () => knowhereJob),
        get: vi.fn(),
        upload: vi.fn(async () => undefined),
      },
      documents: {
        archive: vi.fn(async () => undefined),
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
    };
    const ensureApiKeyForWorkspace = vi.fn(async () => "jwt_123");
    const uploadSourceToKnowhere = vi.fn(async () => source);
    const onUploadFinished = vi.fn();
    const service = createSourceRouteService({
      ensureApiKeyForWorkspace,
      ensureWorkspace: vi.fn(async () => workspace),
      getCurrentUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      makeKnowhereClient: vi.fn(() => knowhereClient),
      sourceService: {
        uploadSourceToKnowhere,
      },
    });
    const file = new File(["hello"], "notes.pdf", {
      type: "application/pdf",
    });

    const result = await service.uploadSource({
      cookieHeader: "session=abc",
      onUploadFinished,
      upload: { type: "file", file },
    });

    expect(result).toEqual({
      status: 201,
      body: {
        source: {
          id: "source_1",
          kind: "workspace",
          title: "notes.pdf",
          status: "parsing",
          mimeType: "application/pdf",
          documentId: undefined,
        },
      },
    });
    expect(ensureApiKeyForWorkspace).toHaveBeenCalledWith(
      workspace.id,
      "session=abc",
    );
    expect(uploadSourceToKnowhere).toHaveBeenCalledWith(
      workspace,
      file,
      knowhereClient,
    );
    expect(onUploadFinished).toHaveBeenCalledOnce();
  });

  it("soft-deletes a source when Knowhere says its document is already missing", async () => {
    const readySource: Source = {
      ...source,
      status: "ready",
      knowhereJobId: null,
      knowhereDocumentId: "doc_missing",
    };
    const archiveDocument = vi.fn(async () => {
      throw new Error("Document not found");
    });
    const softDelete = vi.fn(async () => true);
    const service = createSourceRouteService({
      ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
      ensureWorkspace: vi.fn(async () => workspace),
      makeKnowhereClient: vi.fn(() => ({
        documents: {
          archive: archiveDocument,
          listChunks: vi.fn(async () => ({
            chunks: [],
            pagination: {
              page: 1,
              pageSize: 1,
              total: 0,
              totalPages: 0,
            },
          })),
        },
        jobs: {
          create: vi.fn(),
          get: vi.fn(),
          upload: vi.fn(),
        },
      })),
      requireUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      sourceService: {
        findInWorkspace: vi.fn(async () => readySource),
        softDelete,
      },
    });

    const result = await service.archiveSource({
      cookieHeader: "session=abc",
      sourceId: "source_1",
    });

    expect(result).toEqual({
      status: 200,
      body: {
        id: "source_1",
        archived: true,
      },
    });
    expect(archiveDocument).toHaveBeenCalledWith("doc_missing");
    expect(softDelete).toHaveBeenCalledWith(workspace.id, "source_1");
  });

  it("does not soft-delete a source when Knowhere archive fails unexpectedly", async () => {
    const readySource: Source = {
      ...source,
      status: "ready",
      knowhereJobId: null,
      knowhereDocumentId: "doc_unavailable",
    };
    const softDelete = vi.fn(async () => true);
    const service = createSourceRouteService({
      ensureApiKeyForWorkspace: vi.fn(async () => "jwt_123"),
      ensureWorkspace: vi.fn(async () => workspace),
      makeKnowhereClient: vi.fn(() => ({
        documents: {
          archive: vi.fn(async () => {
            throw new Error("Knowhere unavailable");
          }),
          listChunks: vi.fn(async () => ({
            chunks: [],
            pagination: {
              page: 1,
              pageSize: 1,
              total: 0,
              totalPages: 0,
            },
          })),
        },
        jobs: {
          create: vi.fn(),
          get: vi.fn(),
          upload: vi.fn(),
        },
      })),
      requireUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      sourceService: {
        findInWorkspace: vi.fn(async () => readySource),
        softDelete,
      },
    });

    await expect(
      service.archiveSource({
        cookieHeader: "session=abc",
        sourceId: "source_1",
      }),
    ).rejects.toThrow();
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("retries a failed source from its saved original Blob", async () => {
    const failedSource: Source = {
      ...source,
      status: "failed",
      failureReason: "Knowhere upload failed.",
      originalBlobPathname: "source-uploads/upload_1/document.pdf",
      originalBlobUrl:
        "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
    };
    const parsingSource: Source = {
      ...failedSource,
      status: "parsing",
      failureReason: null,
      failureStage: null,
      knowhereJobId: "job_retry",
    };
    const knowhereClient = {
      jobs: {
        create: vi.fn(),
        get: vi.fn(),
        upload: vi.fn(),
      },
      documents: {
        archive: vi.fn(async () => undefined),
        listChunks: vi.fn(async () => ({
          chunks: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 0,
          },
        })),
      },
    };
    const ensureApiKeyForWorkspace = vi.fn(async () => "jwt_123");
    const retrySourceToKnowhere = vi.fn(async () => parsingSource);
    const service = createSourceRouteService({
      ensureApiKeyForWorkspace,
      ensureWorkspace: vi.fn(async () => workspace),
      makeKnowhereClient: vi.fn(() => knowhereClient),
      requireUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      sourceService: {
        findInWorkspace: vi.fn(async () => failedSource),
        retrySourceToKnowhere,
      },
    });

    const result = await service.retrySource({
      cookieHeader: "session=abc",
      sourceId: "source_1",
    });

    expect(result).toEqual({
      status: 200,
      body: {
        source: {
          id: "source_1",
          kind: "workspace",
          title: "notes.pdf",
          status: "parsing",
          mimeType: "application/pdf",
          documentId: undefined,
          originalFile: {
            url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
            mimeType: "application/pdf",
            sizeBytes: 5,
          },
        },
      },
    });
    expect(ensureApiKeyForWorkspace).toHaveBeenCalledWith(
      workspace.id,
      "session=abc",
    );
    expect(retrySourceToKnowhere).toHaveBeenCalledWith(
      workspace,
      failedSource,
      knowhereClient,
    );
  });

  it("rejects retry when the failed source has no saved original Blob", async () => {
    const failedSource: Source = {
      ...source,
      status: "failed",
      failureReason: "Knowhere upload failed.",
      originalBlobPathname: null,
      originalBlobUrl: null,
    };
    const ensureApiKeyForWorkspace = vi.fn(async () => "jwt_123");
    const retrySourceToKnowhere = vi.fn();
    const service = createSourceRouteService({
      ensureApiKeyForWorkspace,
      ensureWorkspace: vi.fn(async () => workspace),
      requireUser: vi.fn(async () => ({
        id: "user_1",
        email: null,
        name: null,
      })),
      sourceService: {
        findInWorkspace: vi.fn(async () => failedSource),
        retrySourceToKnowhere,
      },
    });

    const result = await service.retrySource({
      cookieHeader: "session=abc",
      sourceId: "source_1",
    });

    expect(result).toEqual({
      status: 409,
      body: {
        message:
          "This source cannot be retried because its original file is unavailable.",
      },
    });
    expect(ensureApiKeyForWorkspace).not.toHaveBeenCalled();
    expect(retrySourceToKnowhere).not.toHaveBeenCalled();
  });
});

const emptyDemoCatalog: DemoCatalog = {
  officialLibrary: { categories: [], sources: [] },
  sources: [],
};

const demoCatalog: DemoCatalog = {
  officialLibrary: { categories: [], sources: [] },
  sources: [
    {
      demoSourceId: "demo-tsla-q4-2025",
      canonicalDocumentId: "demo-doc-tsla-q4-2025",
      title: "TSLA-Q4-2025-Update.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      status: "ready",
      chunkCount: 70,
      originalFile: {
        url: "https://example.com/tsla-q4-2025.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        canDownload: false,
      },
      examples: [],
    },
  ],
};
