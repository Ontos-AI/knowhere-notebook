import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const archive = vi.fn();
  return {
    archive,
    deleteBlob: vi.fn(),
    ensureApiKeyForWorkspace: vi.fn(),
    ensureWorkspace: vi.fn(),
    fetchDemoCatalog: vi.fn(),
    findSourceInWorkspace: vi.fn(),
    getCurrentUser: vi.fn(),
    hideDemoSource: vi.fn(),
    makeKnowhereClient: vi.fn(),
    requireUser: vi.fn(),
    softDeleteSource: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ cookie: "session=abc" })),
}));

vi.mock("@vercel/blob", () => ({
  del: mocks.deleteBlob,
}));

vi.mock("@/integrations/dashboard/api-key-service", () => ({
  ensureApiKeyForWorkspace: mocks.ensureApiKeyForWorkspace,
}));

vi.mock("@/integrations/knowhere-demo", () => ({
  knowhereDemoApi: {
    fetchCatalog: mocks.fetchDemoCatalog,
    fetchChunkPage: vi.fn(),
  },
}))

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireUser: mocks.requireUser,
}));

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClient: mocks.makeKnowhereClient,
}));

vi.mock("@/domains/sources/service", () => ({
  sourceService: {
    findInWorkspace: mocks.findSourceInWorkspace,
    hideDemoSource: mocks.hideDemoSource,
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
      "session=abc",
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
    mocks.fetchDemoCatalog.mockResolvedValue({ sources: [] });

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

  it("archives materialized demo sources and records canonical visibility", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" });
    mocks.findSourceInWorkspace.mockResolvedValue({
      id: "source_demo",
      demoKey: "demo-tsla-q4-2025",
      knowhereDocumentId: "doc_user_copy",
      originalBlobPathname: null,
    });
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123");
    mocks.makeKnowhereClient.mockReturnValue({
      documents: { archive: mocks.archive },
    });
    mocks.archive.mockResolvedValue(undefined);
    mocks.softDeleteSource.mockResolvedValue(true);
    mocks.hideDemoSource.mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost:3001/api/sources/source_demo", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
      { params: Promise.resolve({ sourceId: "source_demo" }) },
    );

    await expect(response.json()).resolves.toEqual({
      id: "source_demo",
      archived: true,
    });
    expect(response.status).toBe(200);
    expect(mocks.ensureApiKeyForWorkspace).toHaveBeenCalledWith(
      "workspace_1",
      "session=abc",
    );
    expect(mocks.archive).toHaveBeenCalledWith("doc_user_copy");
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
    expect(mocks.softDeleteSource).toHaveBeenCalledWith(
      "workspace_1",
      "source_demo",
    );
    expect(mocks.hideDemoSource).toHaveBeenCalledWith(
      "workspace_1",
      "demo-tsla-q4-2025",
    );
  });

  it("hides a canonical demo source before it has a workspace row", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" });
    mocks.findSourceInWorkspace.mockResolvedValue(null);
    mocks.fetchDemoCatalog.mockResolvedValue({
      sources: [
        {
          demoSourceId: "demo-tsla-q4-2025",
        },
      ],
    });
    mocks.hideDemoSource.mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost:3001/api/sources/demo-tsla-q4-2025", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
      { params: Promise.resolve({ sourceId: "demo-tsla-q4-2025" }) },
    );

    await expect(response.json()).resolves.toEqual({
      id: "demo-tsla-q4-2025",
      archived: true,
    });
    expect(response.status).toBe(200);
    expect(mocks.hideDemoSource).toHaveBeenCalledWith(
      "workspace_1",
      "demo-tsla-q4-2025",
    );
    expect(mocks.ensureApiKeyForWorkspace).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });
});
