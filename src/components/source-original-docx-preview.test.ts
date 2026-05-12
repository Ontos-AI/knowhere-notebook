// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceOriginalDocxPreview } from "./source-original-docx-preview";

const docxRenderOptionsLog: unknown[] = [];
const mammothConvertLog: unknown[] = [];
let shouldRejectDocxPreviewRender = false;

vi.mock("docx-preview", () => ({
  renderAsync: vi.fn(
    (
      _data: ArrayBuffer,
      _container: HTMLElement,
      _styleContainer: HTMLElement | undefined,
      options: unknown,
    ) => {
      docxRenderOptionsLog.push(options);
      return shouldRejectDocxPreviewRender
        ? Promise.reject(new Error("docx-preview failed"))
        : Promise.resolve();
    },
  ),
}));

vi.mock("mammoth", () => ({
  default: {
    convertToHtml: vi.fn((input: unknown) => {
      mammothConvertLog.push(input);
      return Promise.resolve({
        value: "<h1>Fallback DOCX</h1><script>alert('x')</script>",
        messages: [],
      });
    }),
  },
}));

describe("SourceOriginalDocxPreview", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    shouldRejectDocxPreviewRender = false;
    docxRenderOptionsLog.length = 0;
    mammothConvertLog.length = 0;
  });

  it("renders DOCX previews without the library fixed page width", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
        ),
      ),
    );

    render(
      React.createElement(SourceOriginalDocxPreview, {
        file: {
          url: "https://example.com/report.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      }),
    );

    await waitFor(() => {
      expect(docxRenderOptionsLog).toHaveLength(1);
    });

    expect(docxRenderOptionsLog[0]).toMatchObject({ ignoreWidth: true });
  });

  it("falls back to sanitized DOCX HTML conversion when docx-preview cannot render", async () => {
    shouldRejectDocxPreviewRender = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
        ),
      ),
    );

    render(
      React.createElement(SourceOriginalDocxPreview, {
        file: {
          url: "https://example.com/report.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Fallback DOCX" })).toBeTruthy();
    });

    expect(mammothConvertLog).toHaveLength(1);
    expect(document.querySelector("script")).toBeNull();
  });
});
