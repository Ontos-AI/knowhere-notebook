import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const archive = vi.fn();
  return {
    archive,
    deleteBlob: vi.fn(),
    ensureApiKeyForWorkspace: vi.fn(),
    ensureWorkspace: vi.fn(),
    findSourceInWorkspace: vi.fn(),
    getCurrentUser: vi.fn(),
    makeKnowhereClient: vi.fn(),
    requireUser: vi.fn(),
    retrySourceToKnowhere: vi.fn(),
    softDeleteSource: vi.fn(),
    startBackgroundReconciliation: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ cookie: "session=abc" })),
}));

vi.mock("@vercel/blob", () => ({
  del: mocks.deleteBlob,
}));

vi.mock("@/integrations/knowhere-credentials", () => ({
  ensureApiKeyForWorkspace: mocks.ensureApiKeyForWorkspace,
}));

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireUser: mocks.requireUser,
}));

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClient: mocks.makeKnowhereClient,
}));

vi.mock("@/domains/sources/background-reconcile", () => ({
  startBackgroundReconciliation: mocks.startBackgroundReconciliation,
}));

vi.mock("@/domains/sources/service", () => ({
  sourceService: {
    findInWorkspace: mocks.findSourceInWorkspace,
    retrySourceToKnowhere: mocks.retrySourceToKnowhere,
    softDelete: mocks.softDeleteSource,
  },
}));

vi.mock("@/domains/workspace/service", () => ({
  workspaceService: {
    ensureWorkspace: mocks.ensureWorkspace,
  },
}));

import { PATCH } from "./route";

describe("PATCH /api/sources/[sourceId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archives the Knowhere document before soft deleting the source", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" });
    mocks.findSourceInWorkspace.mockResolvedValue({
      id: "source_1",
      knowhereDocumentId: "doc_123",
      originalBlobPathname: "source-uploads/upload_1/document.pdf",
    });
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123");
    mocks.makeKnowhereClient.mockReturnValue({
      documents: { archive: mocks.archive },
    });
    mocks.archive.mockResolvedValue(undefined);
    mocks.softDeleteSource.mockResolvedValue(true);

    const response = await PATCH(
      new NextRequest("http://localhost:3001/api/sources/source_1", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
      { params: Promise.resolve({ sourceId: "source_1" }) },
    );

    await expect(response.json()).resolves.toEqual({
      id: "source_1",
      archived: true,
    });
    expect(mocks.ensureApiKeyForWorkspace).toHaveBeenCalledWith(
      "workspace_1",
    );
    expect(mocks.makeKnowhereClient).toHaveBeenCalledWith("jwt_123");
    expect(mocks.archive).toHaveBeenCalledWith("doc_123");
    expect(mocks.softDeleteSource).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
    );
    expect(mocks.deleteBlob).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
    );
  });

  it("rejects archive requests for unlocalized remote source ids", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" });
    mocks.findSourceInWorkspace.mockResolvedValue(null);

    const response = await PATCH(
      new NextRequest(
        "http://localhost:3001/api/sources/knowhere-doc:default:doc_remote",
        {
          method: "PATCH",
          body: JSON.stringify({ archived: true }),
        },
      ),
      {
        params: Promise.resolve({
          sourceId: "knowhere-doc:default:doc_remote",
        }),
      },
    );

    await expect(response.json()).resolves.toEqual({
      message: "Source not found.",
    });
    expect(response.status).toBe(404);
    expect(mocks.findSourceInWorkspace).toHaveBeenCalledWith(
      "workspace_1",
      "knowhere-doc:default:doc_remote",
    );
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.softDeleteSource).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it("does not fail an already-soft-deleted source when original Blob cleanup fails", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" });
    mocks.findSourceInWorkspace.mockResolvedValue({
      id: "source_1",
      knowhereDocumentId: null,
      originalBlobPathname: "source-uploads/upload_1/document.pdf",
    });
    mocks.softDeleteSource.mockResolvedValue(true);
    mocks.deleteBlob.mockRejectedValue(new Error("blob outage"));

    const response = await PATCH(
      new NextRequest("http://localhost:3001/api/sources/source_1", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
      { params: Promise.resolve({ sourceId: "source_1" }) },
    );

    await expect(response.json()).resolves.toEqual({
      id: "source_1",
      archived: true,
    });
    expect(response.status).toBe(200);
    expect(mocks.softDeleteSource).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
    );
    expect(mocks.deleteBlob).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
    );
  });

  it("retries a failed source and starts background reconciliation", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" });
    mocks.findSourceInWorkspace.mockResolvedValue({
      id: "source_1",
      workspaceId: "workspace_1",
      title: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      status: "failed",
      failureReason: "Knowhere upload failed.",
      knowhereJobId: null,
      knowhereDocumentId: null,
      stagedBlobPathname: null,
      stagedBlobUrl: null,
      originalBlobPathname: "source-uploads/upload_1/document.pdf",
      originalBlobUrl:
        "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      createdAt: new Date("2026-05-10T00:00:00Z"),
      updatedAt: new Date("2026-05-10T00:00:00Z"),
      deletedAt: null,
    });
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123");
    const knowhereClient = {
      jobs: {
        create: vi.fn(),
        get: vi.fn(),
        upload: vi.fn(),
      },
      documents: {
        archive: mocks.archive,
      },
    };
    mocks.makeKnowhereClient.mockReturnValue(knowhereClient);
    mocks.retrySourceToKnowhere.mockResolvedValue({
      id: "source_1",
      workspaceId: "workspace_1",
      title: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      status: "parsing",
      failureReason: null,
      knowhereJobId: "job_retry",
      knowhereDocumentId: null,
      stagedBlobPathname: null,
      stagedBlobUrl: null,
      originalBlobPathname: "source-uploads/upload_1/document.pdf",
      originalBlobUrl:
        "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      createdAt: new Date("2026-05-10T00:00:00Z"),
      updatedAt: new Date("2026-05-10T00:00:00Z"),
      deletedAt: null,
    });
    mocks.startBackgroundReconciliation.mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost:3001/api/sources/source_1", {
        method: "PATCH",
        body: JSON.stringify({ retry: true }),
      }),
      { params: Promise.resolve({ sourceId: "source_1" }) },
    );

    await expect(response.json()).resolves.toEqual({
      source: {
        id: "source_1",
        kind: "workspace",
        title: "lecture.pdf",
        mimeType: "application/pdf",
        status: "parsing",
        documentId: undefined,
        originalFile: {
          url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 5,
        },
      },
    });
    expect(response.status).toBe(200);
    expect(mocks.retrySourceToKnowhere).toHaveBeenCalledWith(
      { id: "workspace_1" },
      expect.objectContaining({ id: "source_1", status: "failed" }),
      knowhereClient,
    );
    expect(mocks.startBackgroundReconciliation).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      "jwt_123",
    );
  });

  it("rejects retry requests for failed rows without a saved original Blob", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" });
    mocks.findSourceInWorkspace.mockResolvedValue({
      id: "source_1",
      status: "failed",
      originalBlobPathname: null,
      originalBlobUrl: null,
    });

    const response = await PATCH(
      new NextRequest("http://localhost:3001/api/sources/source_1", {
        method: "PATCH",
        body: JSON.stringify({ retry: true }),
      }),
      { params: Promise.resolve({ sourceId: "source_1" }) },
    );

    await expect(response.json()).resolves.toEqual({
      message:
        "This source cannot be retried because its original file is unavailable.",
    });
    expect(response.status).toBe(409);
    expect(mocks.ensureApiKeyForWorkspace).not.toHaveBeenCalled();
    expect(mocks.retrySourceToKnowhere).not.toHaveBeenCalled();
  });
});
