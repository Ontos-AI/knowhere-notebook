import { describe, expect, it, vi } from "vitest";

import {
  uploadSourceBlobToKnowhere,
  uploadSourceToKnowhere,
} from "./source-upload";
import type { Source } from "./schema";
import type { Workspace } from "./schema";

const workspace: Workspace = {
  id: "8fca7b54-c2da-48f4-9668-a4b39fbc4d4c",
  userId: "user_1",
  namespace: "notebook-8fca7b54-c2da-48f4-9668-a4b39fbc4d4c",
  createdAt: new Date("2026-05-06T00:00:00Z"),
};

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: workspace.id,
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 12,
    status: "uploading",
    failureReason: null,
    knowhereJobId: null,
    knowhereDocumentId: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("uploadSourceToKnowhere", () => {
  it("validates before creating source rows or temp files", async () => {
    const deps = {
      repository: {
        createUploadingSource: vi.fn(),
        markSourceParsing: vi.fn(),
        markSourceFailed: vi.fn(),
      },
      knowhere: {
        jobs: {
          create: vi.fn(),
          upload: vi.fn(),
        },
      },
    };

    await expect(
      uploadSourceToKnowhere(
        workspace,
        new File(["x"], "image.png", { type: "image/png" }),
        deps,
      ),
    ).rejects.toThrow(/Unsupported file type/);

    expect(deps.repository.createUploadingSource).not.toHaveBeenCalled();
    expect(deps.knowhere.jobs.create).not.toHaveBeenCalled();
  });

  it("creates metadata only, uploads a temp file to Knowhere, and cleans the temp file", async () => {
    const uploadingSource = makeSource();
    const parsingSource = makeSource({
      status: "parsing",
      knowhereJobId: "job_123",
    });
    const deps = {
      repository: {
        createUploadingSource: vi.fn().mockResolvedValue(uploadingSource),
        markSourceParsing: vi.fn().mockResolvedValue(parsingSource),
        markSourceFailed: vi.fn(),
      },
      knowhere: {
        jobs: {
          create: vi.fn().mockResolvedValue({
            jobId: "job_123",
            status: "waiting-file",
            sourceType: "file",
            createdAt: new Date("2026-05-06T00:00:00Z"),
          }),
          upload: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });

    const result = await uploadSourceToKnowhere(workspace, file, deps);

    expect(deps.repository.createUploadingSource).toHaveBeenCalledWith(
      workspace.id,
      {
        title: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: file.size,
      },
    );
    expect(deps.knowhere.jobs.create).toHaveBeenCalledWith({
      sourceType: "file",
      fileName: "notes.pdf",
      namespace: workspace.namespace,
    });
    expect(deps.knowhere.jobs.upload).toHaveBeenCalled();
    expect(deps.repository.markSourceParsing).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "job_123",
    );
    expect(result).toMatchObject({
      id: "source_1",
      title: "notes.pdf",
      status: "parsing",
    });
  });

  it("marks the source failed and still cleans temp files when Knowhere upload fails", async () => {
    const uploadingSource = makeSource();
    const failedSource = makeSource({
      status: "failed",
      failureReason: "Knowhere upload failed.",
    });
    const deps = {
      repository: {
        createUploadingSource: vi.fn().mockResolvedValue(uploadingSource),
        markSourceParsing: vi.fn(),
        markSourceFailed: vi.fn().mockResolvedValue(failedSource),
      },
      knowhere: {
        jobs: {
          create: vi.fn().mockResolvedValue({
            jobId: "job_123",
            status: "waiting-file",
            sourceType: "file",
            createdAt: new Date("2026-05-06T00:00:00Z"),
          }),
          upload: vi.fn().mockRejectedValue(new Error("network")),
        },
      },
    };

    await expect(
      uploadSourceToKnowhere(
        workspace,
        new File(["hello"], "notes.pdf", { type: "application/pdf" }),
        deps,
      ),
    ).rejects.toThrow(/Knowhere upload failed/);

    expect(deps.repository.markSourceFailed).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "Knowhere upload failed.",
    );
  });

  it("downloads a client-uploaded Blob staging file before handing it to Knowhere", async () => {
    const uploadingSource = makeSource({ title: "large.pdf", sizeBytes: 5 });
    const parsingSource = makeSource({
      title: "large.pdf",
      status: "parsing",
      knowhereJobId: "job_123",
      sizeBytes: 5,
    });
    const blobStore = {
      get: vi.fn().mockResolvedValue({
        statusCode: 200,
        stream: new Response("hello").body,
        blob: {
          pathname: "source-uploads/upload_1/document.pdf",
          contentType: "application/pdf",
          size: 5,
        },
      }),
      del: vi.fn().mockResolvedValue(undefined),
    };
    const deps = {
      repository: {
        createUploadingSource: vi.fn().mockResolvedValue(uploadingSource),
        markSourceParsing: vi.fn().mockResolvedValue(parsingSource),
        markSourceFailed: vi.fn(),
      },
      knowhere: {
        jobs: {
          create: vi.fn().mockResolvedValue({
            jobId: "job_123",
            status: "waiting-file",
            sourceType: "file",
            createdAt: new Date("2026-05-06T00:00:00Z"),
          }),
          upload: vi.fn().mockResolvedValue(undefined),
        },
      },
      blobStore,
    };

    const result = await uploadSourceBlobToKnowhere(
      workspace,
      {
        pathname: "source-uploads/upload_1/document.pdf",
        fileName: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
      },
      deps,
    );

    expect(blobStore.get).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
    );
    expect(deps.repository.createUploadingSource).toHaveBeenCalledWith(
      workspace.id,
      {
        title: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
      },
    );
    expect(deps.knowhere.jobs.upload).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job_123" }),
      expect.objectContaining({ file: expect.stringContaining("large.pdf") }),
    );
    expect(blobStore.del).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
    );
    expect(result).toMatchObject({
      id: "source_1",
      title: "large.pdf",
      status: "parsing",
    });
  });
});
