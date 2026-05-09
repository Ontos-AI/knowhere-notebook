import { describe, expect, it } from "vitest";

import {
  MAX_UPLOAD_BYTES,
  validateUploadFile,
} from "./source-validation";

describe("validateUploadFile", () => {
  it("accepts supported document extensions within 100 MB", () => {
    const result = validateUploadFile({
      name: "lecture-notes.PDF",
      type: "application/pdf",
      size: MAX_UPLOAD_BYTES,
    });

    expect(result).toEqual({
      ok: true,
      extension: "pdf",
      mimeType: "application/pdf",
      title: "lecture-notes.PDF",
    });
  });

  it("accepts legacy Word and PowerPoint formats", () => {
    const wordResult = validateUploadFile({
      name: "brief.doc",
      type: "",
      size: 1024,
    });
    const deckResult = validateUploadFile({
      name: "deck.ppt",
      type: "",
      size: 1024,
    });

    expect(wordResult).toMatchObject({
      ok: true,
      extension: "doc",
      mimeType: "application/msword",
    });
    expect(deckResult).toMatchObject({
      ok: true,
      extension: "ppt",
      mimeType: "application/vnd.ms-powerpoint",
    });
  });

  it("rejects unsupported file types before Knowhere handoff", () => {
    const result = validateUploadFile({
      name: "photo.png",
      type: "image/png",
      size: 1024,
    });

    expect(result).toEqual({
      ok: false,
      message:
        "Unsupported file type. Upload a PDF, Word, PowerPoint, text, or Markdown document.",
    });
  });

  it("rejects files larger than the 100 MB limit", () => {
    const result = validateUploadFile({
      name: "large.pdf",
      type: "application/pdf",
      size: MAX_UPLOAD_BYTES + 1,
    });

    expect(result).toEqual({
      ok: false,
      message: "File is too large. Upload a document up to 100 MB.",
    });
  });
});
