import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSourceUploadBlobPathname,
  validateSourceBlobUploadInput,
} from "./blob-upload";
import { FILE_TOO_LARGE_MESSAGE, MAX_UPLOAD_BYTES } from "./validation";

describe("source Blob upload metadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an unguessable staging pathname without the original file name", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "upload_1" });

    const file = new File(["hello"], "private-notes.pdf", {
      type: "application/pdf",
    });

    expect(getSourceUploadBlobPathname(file)).toBe(
      "source-uploads/upload_1/document.pdf",
    );
  });

  it("accepts a public Vercel Blob URL that matches the staged pathname", () => {
    const result = validateSourceBlobUploadInput({
      pathname: "source-uploads/upload_1/document.pdf",
      url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      fileName: "large.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(result).toMatchObject({
      ok: true,
      title: "large.pdf",
    });
  });

  it("rejects URLs outside the public Vercel Blob host or staged pathname", () => {
    const mismatchedPath = validateSourceBlobUploadInput({
      pathname: "source-uploads/upload_1/document.pdf",
      url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_2/document.pdf",
      fileName: "large.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    const wrongHost = validateSourceBlobUploadInput({
      pathname: "source-uploads/upload_1/document.pdf",
      url: "https://example.com/source-uploads/upload_1/document.pdf",
      fileName: "large.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(mismatchedPath).toEqual({
      ok: false,
      message: "Invalid upload URL. Choose the document again.",
    });
    expect(wrongHost).toEqual({
      ok: false,
      message: "Invalid upload URL. Choose the document again.",
    });
  });

  it("rejects staged upload metadata larger than the upload limit", () => {
    const result = validateSourceBlobUploadInput({
      pathname: "source-uploads/upload_1/document.pdf",
      url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      fileName: "oversized.pdf",
      mimeType: "application/pdf",
      sizeBytes: MAX_UPLOAD_BYTES + 1,
    });

    expect(result).toEqual({
      ok: false,
      message: FILE_TOO_LARGE_MESSAGE,
    });
  });
});
