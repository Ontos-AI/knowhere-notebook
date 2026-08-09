import { describe, expect, it, vi } from "vitest";

import {
  uploadSourceBlobToKnowhere,
  uploadSourceToKnowhere,
} from "./upload";
import type { Source } from "@/infrastructure/db/schema";
import type { Workspace } from "@/infrastructure/db/schema";

const workspace: Workspace = {
  id: "8fca7b54-c2da-48f4-9668-a4b39fbc4d4c",
  userId: "user_1",
  activeKnowhereApiKeyId: null,
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
          get: vi.fn(),
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
      knowhereDocumentId: "doc_123",
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
          get: vi.fn().mockResolvedValue({
            documentId: "doc_123",
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
      namespace: "notebook-8fca7b54-c2da-48f4-9668-a4b39fbc4d4c",
      documentMetadata: {
        createdByClient: "notebook",
        sourceFileName: "notes.pdf",
        title: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: file.size,
      },
    });
    expect(deps.knowhere.jobs.upload).toHaveBeenCalled();
    expect(deps.knowhere.jobs.get).toHaveBeenCalledWith("job_123");
    expect(deps.repository.markSourceParsing).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "job_123",
      "doc_123",
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
      failureReason: "network",
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
          get: vi.fn(),
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
    ).rejects.toThrow(/network/);

    expect(deps.repository.markSourceFailed).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "network",
    );
    expect(deps.knowhere.jobs.get).not.toHaveBeenCalled();
  });

  it("keeps a queued file upload parsing when Knowhere has not published a document id yet", async () => {
    const uploadingSource = makeSource();
    const parsingSource = makeSource({
      status: "parsing",
      knowhereJobId: "job_123",
      knowhereDocumentId: null,
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
          get: vi.fn().mockResolvedValue({
            status: "running",
          }),
          upload: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });

    const result = await uploadSourceToKnowhere(workspace, file, deps);

    expect(deps.repository.markSourceParsing).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "job_123",
    );
    expect(deps.repository.markSourceFailed).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "source_1",
      status: "parsing",
      knowhereDocumentId: null,
    });
  });

  it("uses the planned document id from the SDK job creation response", async () => {
    const uploadingSource = makeSource();
    const parsingSource = makeSource({
      status: "parsing",
      knowhereJobId: "job_123",
      knowhereDocumentId: "doc_planned",
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
            documentId: "doc_planned",
            createdAt: new Date("2026-05-06T00:00:00Z"),
          }),
          get: vi.fn(),
          upload: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    await uploadSourceToKnowhere(
      workspace,
      new File(["hello"], "notes.pdf", { type: "application/pdf" }),
      deps,
    );

    expect(deps.knowhere.jobs.get).not.toHaveBeenCalled();
    expect(deps.repository.markSourceParsing).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "job_123",
      "doc_planned",
    );
  });

  it("creates a URL parse job from a client-uploaded public Blob", async () => {
    const uploadingSource = makeSource({ title: "large.pdf", sizeBytes: 5 });
    const parsingSource = makeSource({
      title: "large.pdf",
      status: "parsing",
      knowhereJobId: "job_123",
      knowhereDocumentId: "doc_123",
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
          get: vi.fn().mockResolvedValue({
            documentId: "doc_123",
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
      namespace: "notebook-8fca7b54-c2da-48f4-9668-a4b39fbc4d4c",
      documentMetadata: {
        createdByClient: "notebook",
        sourceFileName: "large.pdf",
        title: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
      },
    });
    expect(deps.knowhere.jobs.upload).not.toHaveBeenCalled();
    expect(deps.knowhere.jobs.get).toHaveBeenCalledWith("job_123");
    expect(deps.repository.markSourceParsing).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "job_123",
      "doc_123",
    );
    expect(result).toMatchObject({
      id: "source_1",
      title: "large.pdf",
      status: "parsing",
    });
  });

  it("keeps a URL parse job parsing when Knowhere has not published a document id yet", async () => {
    const uploadingSource = makeSource({ title: "large.pdf", sizeBytes: 5 });
    const parsingSource = makeSource({
      title: "large.pdf",
      status: "parsing",
      knowhereJobId: "job_123",
      knowhereDocumentId: null,
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
          get: vi.fn().mockResolvedValue({
            status: "running",
          }),
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

    expect(deps.repository.markSourceParsing).toHaveBeenCalledWith(
      workspace.id,
      uploadingSource.id,
      "job_123",
    );
    expect(deps.repository.markSourceFailed).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "source_1",
      status: "parsing",
      knowhereDocumentId: null,
    });
  });

  it("keeps the original public Blob and returns a failed source when URL job creation fails", async () => {
    const uploadingSource = makeSource({ title: "large.pdf", sizeBytes: 5 });
    const failedSource = makeSource({
      title: "large.pdf",
      status: "failed",
      failureReason: "network",
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
          get: vi.fn(),
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
      "network",
    );
  });
});
