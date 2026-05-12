import { describe, expect, it, vi } from "vitest";

import {
  ensureDemoSourceUpload,
  uploadSourceBlobToKnowhere,
  uploadSourceToKnowhere,
} from "./upload";
import type { Source } from "@/infrastructure/db/schema";
import type { Workspace } from "@/infrastructure/db/schema";

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
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
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
        new File(["x"], "deck.ppt", { type: "application/vnd.ms-powerpoint" }),
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

  it("creates a URL parse job from a client-uploaded public Blob", async () => {
    const uploadingSource = makeSource({ title: "large.pdf", sizeBytes: 5 });
    const parsingSource = makeSource({
      title: "large.pdf",
      status: "parsing",
      knowhereJobId: "job_123",
      sizeBytes: 5,
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
            status: "pending",
            sourceType: "url",
            createdAt: new Date("2026-05-06T00:00:00Z"),
          }),
          upload: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    const result = await uploadSourceBlobToKnowhere(
      workspace,
      {
        pathname: "source-uploads/upload_1/document.pdf",
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        fileName: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
      },
      deps,
    );

    expect(deps.repository.createUploadingSource).toHaveBeenCalledWith(
      workspace.id,
      {
        title: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
        originalBlobPathname: "source-uploads/upload_1/document.pdf",
        originalBlobUrl: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      },
    );
    expect(deps.knowhere.jobs.create).toHaveBeenCalledWith({
      sourceType: "url",
      sourceUrl: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      fileName: "large.pdf",
      namespace: workspace.namespace,
    });
    expect(deps.knowhere.jobs.upload).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "source_1",
      title: "large.pdf",
      status: "parsing",
    });
  });

  it("keeps the original public Blob and returns a failed source when URL job creation fails", async () => {
    const uploadingSource = makeSource({ title: "large.pdf", sizeBytes: 5 });
    const failedSource = makeSource({
      title: "large.pdf",
      status: "failed",
      failureReason: "Knowhere upload failed.",
      sizeBytes: 5,
      originalBlobPathname: "source-uploads/upload_1/document.pdf",
      originalBlobUrl: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
    });
    const deps = {
      repository: {
        createUploadingSource: vi.fn().mockResolvedValue(uploadingSource),
        markSourceParsing: vi.fn(),
        markSourceFailed: vi.fn().mockResolvedValue(failedSource),
      },
      knowhere: {
        jobs: {
          create: vi.fn().mockRejectedValue(new Error("network")),
          upload: vi.fn(),
        },
      },
    };

    const result = await uploadSourceBlobToKnowhere(
      workspace,
      {
        pathname: "source-uploads/upload_1/document.pdf",
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        fileName: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
      },
      deps,
    );

    expect(result).toMatchObject({
      status: "failed",
      originalBlobUrl: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
    });
    expect(deps.repository.markSourceFailed).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "Knowhere upload failed.",
    );
  });
});

describe("ensureDemoSourceUpload", () => {
  const demoInput = {
    demoKey: "demo-tsla-q4-2025",
    documentId: "demo-doc-tsla-q4-2025",
    title: "TSLA-Q4-2025-Update.pdf",
    mimeType: "application/pdf",
    originalSizeBytes: 5,
    originalFileUrl: "/demo-sources/tsla-q4-2025/original.pdf",
    originalFileSystemPath: "/repo/public/demo-sources/tsla-q4-2025/original.pdf",
  } as const;

  it("uploads a bundled demo file into the workspace namespace", async () => {
    const uploadingSource = makeSource({
      demoKey: demoInput.demoKey,
      title: demoInput.title,
      sizeBytes: demoInput.originalSizeBytes,
      originalBlobUrl: demoInput.originalFileUrl,
    });
    const parsingSource = makeSource({
      ...uploadingSource,
      status: "parsing",
      knowhereJobId: "job_demo",
    });
    const deps = {
      repository: {
        findSourceByDemoKey: vi.fn().mockResolvedValue(null),
        createDemoUploadingSource: vi.fn().mockResolvedValue(uploadingSource),
        markDemoSourceUploading: vi.fn(),
        markSourceParsing: vi.fn().mockResolvedValue(parsingSource),
        markSourceFailed: vi.fn(),
      },
      knowhere: {
        jobs: {
          create: vi.fn().mockResolvedValue({
            jobId: "job_demo",
            status: "waiting-file",
            sourceType: "file",
            createdAt: new Date("2026-05-06T00:00:00Z"),
          }),
          upload: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    const result = await ensureDemoSourceUpload(workspace, demoInput, deps);

    expect(deps.repository.findSourceByDemoKey).toHaveBeenCalledWith(
      workspace.id,
      demoInput.demoKey,
    );
    expect(deps.repository.createDemoUploadingSource).toHaveBeenCalledWith(
      workspace.id,
      {
        demoKey: demoInput.demoKey,
        title: demoInput.title,
        mimeType: demoInput.mimeType,
        sizeBytes: demoInput.originalSizeBytes,
        originalBlobUrl: demoInput.originalFileUrl,
      },
    );
    expect(deps.knowhere.jobs.create).toHaveBeenCalledWith({
      sourceType: "file",
      fileName: demoInput.title,
      namespace: workspace.namespace,
    });
    expect(deps.knowhere.jobs.upload).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job_demo" }),
      { file: demoInput.originalFileSystemPath },
    );
    expect(deps.repository.markSourceParsing).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "job_demo",
    );
    expect(result).toBe(parsingSource);
  });

  it("does not upload the bundled demo file again when the workspace already has it", async () => {
    const existingSource = makeSource({
      demoKey: demoInput.demoKey,
      status: "parsing",
      knowhereJobId: "job_existing",
    });
    const deps = {
      repository: {
        findSourceByDemoKey: vi.fn().mockResolvedValue(existingSource),
        createDemoUploadingSource: vi.fn(),
        markDemoSourceUploading: vi.fn(),
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

    const result = await ensureDemoSourceUpload(workspace, demoInput, deps);

    expect(result).toBe(existingSource);
    expect(deps.repository.createDemoUploadingSource).not.toHaveBeenCalled();
    expect(deps.knowhere.jobs.create).not.toHaveBeenCalled();
    expect(deps.knowhere.jobs.upload).not.toHaveBeenCalled();
  });

  it("uploads once for legacy static demo rows that were never sent to Knowhere", async () => {
    const legacySource = makeSource({
      demoKey: demoInput.demoKey,
      status: "ready",
      knowhereDocumentId: demoInput.documentId,
      knowhereJobId: null,
    });
    const uploadingSource = makeSource({
      ...legacySource,
      status: "uploading",
      knowhereDocumentId: null,
    });
    const parsingSource = makeSource({
      ...uploadingSource,
      status: "parsing",
      knowhereJobId: "job_demo",
    });
    const deps = {
      repository: {
        findSourceByDemoKey: vi.fn().mockResolvedValue(legacySource),
        createDemoUploadingSource: vi.fn(),
        markDemoSourceUploading: vi.fn().mockResolvedValue(uploadingSource),
        markSourceParsing: vi.fn().mockResolvedValue(parsingSource),
        markSourceFailed: vi.fn(),
      },
      knowhere: {
        jobs: {
          create: vi.fn().mockResolvedValue({
            jobId: "job_demo",
            status: "waiting-file",
            sourceType: "file",
            createdAt: new Date("2026-05-06T00:00:00Z"),
          }),
          upload: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    const result = await ensureDemoSourceUpload(workspace, demoInput, deps);

    expect(deps.repository.createDemoUploadingSource).not.toHaveBeenCalled();
    expect(deps.repository.markDemoSourceUploading).toHaveBeenCalledWith(
      workspace.id,
      legacySource.id,
      {
        title: demoInput.title,
        mimeType: demoInput.mimeType,
        sizeBytes: demoInput.originalSizeBytes,
        originalBlobUrl: demoInput.originalFileUrl,
      },
    );
    expect(deps.knowhere.jobs.create).toHaveBeenCalledWith({
      sourceType: "file",
      fileName: demoInput.title,
      namespace: workspace.namespace,
    });
    expect(result).toBe(parsingSource);
  });
});
