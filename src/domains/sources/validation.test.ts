import { describe, expect, it } from "vitest";

import {
  FILE_TOO_LARGE_MESSAGE,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  validateUploadFile,
} from "./validation";

describe("validateUploadFile", () => {
  it("accepts supported document extensions within the upload limit", () => {
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

  it("accepts the Knowhere-supported preview source extensions", () => {
    const wordResult = validateUploadFile({
      name: "brief.doc",
      type: "",
      size: 1024,
    });
    const spreadsheetResult = validateUploadFile({
      name: "forecast.xlsx",
      type: "",
      size: 1024,
    });
    const imageResult = validateUploadFile({
      name: "diagram.png",
      type: "",
      size: 1024,
    });

    expect(wordResult).toMatchObject({
      ok: true,
      extension: "doc",
      mimeType: "application/msword",
    });
    expect(spreadsheetResult).toMatchObject({
      ok: true,
      extension: "xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(imageResult).toMatchObject({
      ok: true,
      extension: "png",
      mimeType: "image/png",
    });
  });

  it("rejects unsupported file types before Knowhere handoff", () => {
    const result = validateUploadFile({
      name: "deck.ppt",
      type: "application/vnd.ms-powerpoint",
      size: 1024,
    });

    expect(result).toEqual({
      ok: false,
      message:
        "Unsupported file type. Upload a PDF, Word, PowerPoint, spreadsheet, image, text, or Markdown document.",
    });
  });

  it("rejects files larger than the upload limit", () => {
    const result = validateUploadFile({
      name: "large.pdf",
      type: "application/pdf",
      size: MAX_UPLOAD_BYTES + 1,
    });

    expect(result).toEqual({
      ok: false,
      message: FILE_TOO_LARGE_MESSAGE,
    });
    expect(MAX_UPLOAD_MB).toBe(300);
  });
});
