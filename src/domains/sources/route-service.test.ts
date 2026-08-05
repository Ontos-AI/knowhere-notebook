import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { Job } from "@ontos-ai/knowhere-sdk";

import type { Source, Workspace } from "@/infrastructure/db/schema";
import { createRouteListing } from "./route-listing";
import { createSourceRouteService } from "./route-service";

const workspace: Workspace = {
  id: "workspace_1",
  userId: "user_1",
  activeKnowhereApiKeyId: null,
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
    const listing = createRouteListing({
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
    );
    expect(listSourcesForWorkspace).toHaveBeenCalledWith(workspace.id);
    expect(reconcileSourcesForWorkspace).not.toHaveBeenCalled();
    expect(startBackgroundReconciliation).toHaveBeenCalledWith(
      workspace.id,
      source.id,
      "jwt_123",
    );
  });

  it("lists workspace-namespace documents as lightweight remote sources", async () => {
    const localReadySource: Source = {
      ...source,
      id: "source_ready",
      status: "ready",
      knowhereJobId: null,
      knowhereDocumentId: "doc_local",
    };
    const listDocuments = vi.fn().mockResolvedValueOnce({
      documents: [
        {
          documentId: "doc_local",
          namespace: workspace.namespace,
          status: "active",
          sourceFileName: "local-duplicate.pdf",
        },
        {
          documentId: "doc_new",
          namespace: workspace.namespace,
          status: "active",
          sourceFileName: "new.pdf",
          documentMetadata: {
            mimeType: "application/pdf",
          },
        },
      ],
      pagination: {
        page: 1,
        pageSize: 200,
        total: 2,
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
    const localizeRemoteDocument = vi.fn(async (_workspaceId: string, input: { documentId: string; title?: string; mimeType?: string }) => ({
      ...source,
      id: `source_${input.documentId}`,
      workspaceId: _workspaceId,
      title: input.title ?? input.documentId,
      mimeType: input.mimeType ?? "application/octet-stream",
      status: "ready" as const,
      knowhereJobId: null,
      knowhereDocumentId: input.documentId,
    })) as unknown as Parameters<typeof createRouteListing>[0]["sourceService"]["localizeRemoteDocument"];
    const listing = createRouteListing({
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
        localizeRemoteDocument,
      },
    });

    const result = await listing.listSources({ cookieHeader: "session=abc" });

    expect(listDocuments).toHaveBeenCalledTimes(1);
    expect(listDocuments).toHaveBeenNthCalledWith(1, {
      namespace: workspace.namespace,
      page: 1,
      pageSize: 200,
    });
    expect(localizeRemoteDocument).toHaveBeenCalledTimes(1);
    expect(localizeRemoteDocument).toHaveBeenCalledWith(workspace.id, expect.objectContaining({ documentId: "doc_new" }));
    expect(localizeRemoteDocument).not.toHaveBeenCalledWith(workspace.id, expect.objectContaining({ documentId: "doc_local" }));
    expect(result.body.sources).toEqual([
      expect.objectContaining({
        id: "source_ready",
        documentId: "doc_local",
        title: "notes.pdf",
        status: "ready",
      }),
      expect.objectContaining({
        id: "source_doc_new",
        kind: "workspace",
        title: "new.pdf",
        mimeType: "application/pdf",
        status: "ready",
        documentId: "doc_new",
      }),
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

  it("lists no sources for anonymous users", async () => {
    const ensureWorkspace = vi.fn(async () => workspace);
    const service = createSourceRouteService({
      ensureWorkspace,
      getCurrentUser: vi.fn(async () => null),
    });

    const result = await service.listSources({ cookieHeader: "" });

    expect(result).toEqual({
      status: 200,
      body: {
        sources: [],
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
    );
    expect(uploadSourceToKnowhere).toHaveBeenCalledWith(
      workspace,
      file,
      knowhereClient,
    );
    expect(onUploadFinished).toHaveBeenCalledOnce();
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
