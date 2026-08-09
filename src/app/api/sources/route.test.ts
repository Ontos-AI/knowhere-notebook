import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Source, Workspace } from "@/infrastructure/db/schema";

const mocks = vi.hoisted(() => {
  return {
    ensureApiKeyForWorkspace: vi.fn(),
    getCurrentUser: vi.fn(),
    makeKnowhereClient: vi.fn(),
    revalidatePath: vi.fn(),
    requireUser: vi.fn(),
    uploadSourceBlobToKnowhere: vi.fn(),
    uploadSourceToKnowhere: vi.fn(),
    ensureWorkspace: vi.fn(),
    findWorkspaceByIdAndUserId: vi.fn(),
    findByIdAndUserIdEffect: vi.fn(),
    databaseRunPromise: vi.fn(),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ cookie: "session=abc" })),
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

vi.mock("@/domains/sources/service", () => ({
  sourceService: {
    uploadSourceBlobToKnowhere: mocks.uploadSourceBlobToKnowhere,
    uploadSourceToKnowhere: mocks.uploadSourceToKnowhere,
  },
}));

vi.mock("@/domains/workspace/service", () => ({
  workspaceService: {
    ensureWorkspace: mocks.ensureWorkspace,
  },
}));

vi.mock("@/domains/workspace/repository", () => ({
  workspaceRepository: {
    findByIdAndUserIdEffect: mocks.findByIdAndUserIdEffect,
  },
}));

vi.mock("@/domains/workspace/database-runtime", () => ({
  databaseRuntime: {
    runPromise: mocks.databaseRunPromise,
  },
}));

import { POST } from "./route";

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

describe("POST /api/sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue(workspace);
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123");
    mocks.makeKnowhereClient.mockReturnValue({ jobs: {} });
    mocks.uploadSourceBlobToKnowhere.mockResolvedValue(source);
    mocks.uploadSourceToKnowhere.mockResolvedValue(source);
    mocks.findByIdAndUserIdEffect.mockReturnValue(
      Promise.resolve(workspace),
    );
    mocks.databaseRunPromise.mockImplementation(
      (effect: Promise<unknown>) => Promise.resolve(effect),
    );
  });

  it("uploads multipart files through the route handler", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(["hello"], "notes.pdf", { type: "application/pdf" }),
    );

    const response = await POST(
      new NextRequest("http://localhost:3001/api/sources", {
        method: "POST",
        body: formData,
      }),
    );

    await expect(response.json()).resolves.toEqual({
      source: {
        id: "source_1",
        kind: "workspace",
        title: "notes.pdf",
        status: "parsing",
        mimeType: "application/pdf",
      },
    });
    expect(response.status).toBe(201);
    expect(mocks.ensureApiKeyForWorkspace).toHaveBeenCalledWith(
      workspace.id,
    );
    expect(mocks.uploadSourceToKnowhere).toHaveBeenCalledWith(
      workspace,
      expect.objectContaining({ name: "notes.pdf" }),
      { jobs: {} },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("uploads to an explicitly targeted workspace the user belongs to", async () => {
    const targetWorkspace: Workspace = {
      id: "workspace_target",
      userId: "user_1",
      activeKnowhereApiKeyId: null,
      namespace: "adobe",
      createdAt: new Date("2026-05-10T00:00:00Z"),
    };
    mocks.findByIdAndUserIdEffect.mockReturnValue(
      Promise.resolve(targetWorkspace),
    );

    const formData = new FormData();
    formData.set(
      "file",
      new File(["hello"], "notes.pdf", { type: "application/pdf" }),
    );
    formData.set("workspaceId", "workspace_target");

    const response = await POST(
      new NextRequest("http://localhost:3001/api/sources", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.ensureWorkspace).not.toHaveBeenCalled();
    expect(mocks.ensureApiKeyForWorkspace).toHaveBeenCalledWith(
      "workspace_target",
    );
    expect(mocks.uploadSourceToKnowhere).toHaveBeenCalledWith(
      targetWorkspace,
      expect.objectContaining({ name: "notes.pdf" }),
      { jobs: {} },
    );
  });

  it("creates a source from a Blob-backed upload without sending the file through the route body", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3001/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          upload: {
            type: "blob",
            pathname: "source-uploads/upload_1/document.pdf",
            url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
            fileName: "large.pdf",
            mimeType: "application/pdf",
            sizeBytes: 5 * 1024 * 1024,
          },
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      source: {
        id: "source_1",
        kind: "workspace",
        title: "notes.pdf",
        status: "parsing",
        mimeType: "application/pdf",
      },
    });
    expect(response.status).toBe(201);
    expect(mocks.uploadSourceBlobToKnowhere).toHaveBeenCalledWith(
      workspace,
      {
        pathname: "source-uploads/upload_1/document.pdf",
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        fileName: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5 * 1024 * 1024,
      },
      { jobs: {} },
    );
    expect(mocks.uploadSourceToKnowhere).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("returns a friendly validation response when no file is selected", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3001/api/sources", {
        method: "POST",
        body: new FormData(),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      message: "Choose a document to upload.",
    });
    expect(response.status).toBe(400);
    expect(mocks.uploadSourceToKnowhere).not.toHaveBeenCalled();
  });

  it("returns a friendly error response when upload processing fails", async () => {
    mocks.uploadSourceToKnowhere.mockRejectedValue(new Error("network down"));
    const formData = new FormData();
    formData.set(
      "file",
      new File(["hello"], "notes.pdf", { type: "application/pdf" }),
    );

    const response = await POST(
      new NextRequest("http://localhost:3001/api/sources", {
        method: "POST",
        body: formData,
      }),
    );

    await expect(response.json()).resolves.toEqual({
      message: "Upload failed. Try again or choose another file.",
    });
    expect(response.status).toBe(500);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });
});
