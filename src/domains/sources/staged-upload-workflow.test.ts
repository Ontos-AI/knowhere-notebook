import { describe, expect, it, vi } from "vitest";

import { stagedUploadWorkflow } from "./staged-upload-workflow";
import type { SourceView } from "./types";

const uploadedSource: SourceView = {
  id: "source_1",
  title: "notes.pdf",
  mimeType: "application/pdf",
  status: "parsing",
};

describe("stagedUploadWorkflow", () => {
  it("uploads to Blob staging before handing metadata to the Source route", async () => {
    const uploadBlob = vi.fn(async () => ({
      pathname: "source-uploads/upload_1/document.pdf",
      url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
    }));
    const postMetadata = vi.fn(async () => ({
      status: 201,
      body: { source: uploadedSource },
    }));
    const cleanupBlob = vi.fn(async () => undefined);
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });

    const response = await stagedUploadWorkflow.upload(file, {
      cleanupBlob,
      getPathname: () => "source-uploads/upload_1/document.pdf",
      postMetadata,
      uploadBlob,
    });

    expect(response).toEqual({ status: 201, body: { source: uploadedSource } });
    expect(uploadBlob).toHaveBeenCalledBefore(postMetadata);
    expect(postMetadata).toHaveBeenCalledWith({
      fileName: "notes.pdf",
      mimeType: "application/pdf",
      pathname: "source-uploads/upload_1/document.pdf",
      sizeBytes: file.size,
      url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
    });
    expect(cleanupBlob).not.toHaveBeenCalled();
  });

  it("cleans up the staged Blob when metadata handoff fails", async () => {
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    const cleanupBlob = vi.fn(async () => undefined);

    const response = await stagedUploadWorkflow.upload(file, {
      cleanupBlob,
      getPathname: () => "source-uploads/upload_1/document.pdf",
      postMetadata: vi.fn(async () => ({
        status: 500,
        body: { message: "Upload failed." },
      })),
      uploadBlob: vi.fn(async () => ({
        pathname: "source-uploads/upload_1/document.pdf",
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      })),
    });

    expect(response).toEqual({
      status: 500,
      body: { message: "Upload failed." },
    });
    expect(cleanupBlob).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
    );
  });
});
