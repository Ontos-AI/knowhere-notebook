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

vi.mock("@/lib/api-key-service", () => ({
  ensureApiKeyForWorkspace: mocks.ensureApiKeyForWorkspace,
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClient: mocks.makeKnowhereClient,
}));

vi.mock("@/domains/workspace", () => ({
  ensureWorkspace: mocks.ensureWorkspace,
  findSourceInWorkspace: mocks.findSourceInWorkspace,
  softDeleteSource: mocks.softDeleteSource,
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

  it("soft deletes demo sources without calling Knowhere archive or Blob cleanup", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" });
    mocks.findSourceInWorkspace.mockResolvedValue({
      id: "source_demo",
      demoKey: "demo-tsla-q4-2025",
      knowhereDocumentId: "demo-doc-tsla-q4-2025",
      originalBlobPathname: null,
    });
    mocks.softDeleteSource.mockResolvedValue(true);

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
    expect(mocks.ensureApiKeyForWorkspace).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
    expect(mocks.softDeleteSource).toHaveBeenCalledWith(
      "workspace_1",
      "source_demo",
    );
  });
});
