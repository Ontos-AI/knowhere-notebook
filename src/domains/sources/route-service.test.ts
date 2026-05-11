import { describe, expect, it, vi } from "vitest";
import type { Job } from "@ontos-ai/knowhere-sdk";

import type { Source, Workspace } from "@/infrastructure/db/schema";
import { createSourceRouteService } from "./route-service";

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
  it("lists bundled demo sources for anonymous users", async () => {
    const demoSource = {
      id: "demo_source_1",
      title: "Demo.pdf",
      status: "ready" as const,
      mimeType: "application/pdf",
      documentId: "demo_doc_1",
      chunkCount: 3,
    };
    const ensureWorkspace = vi.fn(async () => workspace);
    const service = createSourceRouteService({
      demoData: {
        listSources: vi.fn(() => [demoSource]),
      },
      ensureWorkspace,
      getCurrentUser: vi.fn(async () => null),
    });

    const result = await service.listSources({ cookieHeader: "" });

    expect(result).toEqual({
      status: 200,
      body: { sources: [demoSource] },
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
          title: "notes.pdf",
          status: "parsing",
          mimeType: "application/pdf",
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
