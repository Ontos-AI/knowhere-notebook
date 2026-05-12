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

describe("source route service", () => {
  it("reconciles authenticated sources through the listing route workflow", async () => {
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
        upload: vi.fn(),
      },
    };
    const ensureApiKeyForWorkspace = vi.fn(async () => "jwt_123");
    const getSourceViewOptionsBySourceId = vi.fn(() =>
      Effect.succeed(new Map([[source.id, { chunkCount: 8 }]])),
    );
    const reconcileSourcesForWorkspace = vi.fn(async () => [source]);
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
      reconcileSourcesForWorkspace,
      sourceService: { listHiddenDemoSourceIds },
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
    expect(reconcileSourcesForWorkspace).toHaveBeenCalledWith(
      workspace,
      knowhereClient,
    );
    expect(listHiddenDemoSourceIds).toHaveBeenCalledWith(workspace.id);
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
      reconcileSourcesForWorkspace: vi.fn(async () => [legacyFakeSource, source]),
      sourceService: { listHiddenDemoSourceIds: vi.fn(async () => []) },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(getSourceViewOptionsBySourceId).toHaveBeenCalledWith(
      [source],
      knowhereClient,
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
      reconcileSourcesForWorkspace: vi.fn(async () => [legacyFakeSource]),
      sourceService: { listHiddenDemoSourceIds: vi.fn(async () => []) },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(getSourceViewOptionsBySourceId).toHaveBeenCalledWith(
      [],
      knowhereClient,
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
              url: "/api/demo-sources/demo-tsla-q4-2025/original",
              mimeType: "application/pdf",
              sizeBytes: 1024,
              canDownload: false,
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
      reconcileSourcesForWorkspace: vi.fn(async () => [nonReadyLegacySource]),
      sourceService: { listHiddenDemoSourceIds: vi.fn(async () => []) },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(getSourceViewOptionsBySourceId).toHaveBeenCalledWith(
      [],
      knowhereClient,
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
              url: "/api/demo-sources/demo-tsla-q4-2025/original",
              mimeType: "application/pdf",
              sizeBytes: 1024,
              canDownload: false,
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
});

const emptyDemoCatalog: DemoCatalog = {
  sources: [],
};

const demoCatalog: DemoCatalog = {
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
        url: "/api/v1/demo/sources/demo-tsla-q4-2025/original",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        canDownload: false,
      },
      examples: [],
    },
  ],
};
