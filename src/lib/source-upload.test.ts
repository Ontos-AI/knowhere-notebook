import { describe, expect, it, vi } from "vitest";

import { uploadSourceToKnowhere } from "./source-upload";
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
      tempFiles: {
        write: vi.fn(),
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
    expect(deps.tempFiles.write).not.toHaveBeenCalled();
    expect(deps.knowhere.jobs.create).not.toHaveBeenCalled();
  });

  it("creates metadata only, uploads a temp file to Knowhere, and cleans the temp file", async () => {
    const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
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
      tempFiles: {
        write: vi
          .fn()
          .mockResolvedValue({ path: "/tmp/knowhere-upload/notes.pdf", cleanup }),
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
    expect(deps.knowhere.jobs.upload).toHaveBeenCalledWith(
      {
        jobId: "job_123",
        status: "waiting-file",
        sourceType: "file",
        createdAt: new Date("2026-05-06T00:00:00Z"),
      },
      { file: "/tmp/knowhere-upload/notes.pdf" },
    );
    expect(deps.repository.markSourceParsing).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "job_123",
    );
    expect(cleanup).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      id: "source_1",
      title: "notes.pdf",
      status: "parsing",
    });
  });

  it("marks the source failed and still cleans temp files when Knowhere upload fails", async () => {
    const cleanup = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
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
      tempFiles: {
        write: vi.fn().mockResolvedValue({ path: "/tmp/file.pdf", cleanup }),
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
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
