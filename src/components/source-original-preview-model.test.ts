import { describe, expect, it } from "vitest";

import { sourceOriginalPreviewModel } from "./source-original-preview-model";

describe("sourceOriginalPreviewModel", () => {
  it("classifies original files from MIME type and extension", () => {
    expect(
      sourceOriginalPreviewModel.getPreviewKind("report", "application/pdf"),
    ).toBe("pdf");
    expect(sourceOriginalPreviewModel.getPreviewKind("notes.md", "")).toBe(
      "markdown",
    );
    expect(sourceOriginalPreviewModel.getPreviewKind("draft.docx", "")).toBe(
      "docx",
    );
    expect(sourceOriginalPreviewModel.getPreviewKind("photo", "image/png"))
      .toBe("image");
  });

  it("keeps large text and DOCX files download-only", () => {
    expect(
      sourceOriginalPreviewModel.isWithinPreviewByteLimit("text", {
        url: "/notes.txt",
        mimeType: "text/plain",
        sizeBytes: 1024 * 1024 + 1,
      }),
    ).toBe(false);
    expect(
      sourceOriginalPreviewModel.isWithinPreviewByteLimit("docx", {
        url: "/draft.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 10 * 1024 * 1024 + 1,
      }),
    ).toBe(false);
    expect(
      sourceOriginalPreviewModel.isWithinPreviewByteLimit("pdf", {
        url: "/large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 50 * 1024 * 1024,
      }),
    ).toBe(true);
  });

  it("normalizes generated Markdown line break tags", () => {
    expect(
      sourceOriginalPreviewModel.normalizeMarkdownPreviewText(
        "A<br>B&lt;br /&gt;C",
      ),
    ).toBe("A\nB\nC");
  });

  it("builds Vercel Blob download URLs without changing local demo assets", () => {
    expect(
      sourceOriginalPreviewModel.getOriginalDownloadUrl(
        "https://store.public.blob.vercel-storage.com/source.pdf",
      ),
    ).toBe(
      "https://store.public.blob.vercel-storage.com/source.pdf?download=1",
    );
    expect(sourceOriginalPreviewModel.getOriginalDownloadUrl("/demo.pdf")).toBe(
      "/demo.pdf",
    );
  });

  it("builds browser PDF URLs for target pages", () => {
    expect(
      sourceOriginalPreviewModel.getBrowserPdfPreviewUrl(
        "https://example.com/report.pdf",
        7,
      ),
    ).toBe("https://example.com/report.pdf#page=7");
    expect(
      sourceOriginalPreviewModel.getBrowserPdfPreviewUrl(
        "https://example.com/report.pdf#page=2",
        3,
      ),
    ).toBe("https://example.com/report.pdf#page=3");
  });
});
