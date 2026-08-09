// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => ({
  upload: mocks.uploadBlob,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    fetchApiKeyNamespaces: vi.fn(async () => []),
    activateWorkspace: vi.fn(async () => {}),
    createWorkspace: vi.fn(async () => ({})),
    fetchUserApiKeys: vi.fn(async () => []),
  },
}));

import { SourcesPanel } from "./sources-panel";

const C = SourcesPanel as React.FC<Record<string, unknown>>;
const originalResizeObserver = globalThis.ResizeObserver;
const fileTooLargeMessage =
  "File is too large. Upload a document up to 300 MB. " +
  "For larger files, contact team@knowhereto.ai or open an issue at https://github.com/Ontos-AI/knowhere/issues.";

describe("SourcesPanel", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        observe(): void { }
        unobserve(): void { }
        disconnect(): void { }
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: originalResizeObserver,
    });
  });

  function renderPanel(overrides: Record<string, unknown> = {}) {
    return React.createElement(C, {
      activeWorkspace: { id: "ws_1", namespace: "adobe" },
      workspaces: [{ id: "ws_1", namespace: "adobe" }],
      knowhereKeyLabels: [],
      ...overrides,
    });
  }

  it("opens the upload dialog from the sidebar trigger", async () => {
    const user = userEvent.setup();

    render(renderPanel({ sources: [] }));

    await user.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(screen.getByRole("heading", { name: "Add source" })).toBeTruthy();
    expect(
      screen.getByText(/Click to select or drag and drop a document/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
  });

  it("keeps the narrow upload trigger visible as a primary icon button", () => {
    render(
      renderPanel({
        isNarrow: true,
        sources: [],
      }),
    );

    const uploadButton = screen.getByRole("button", {
      name: "Upload Document",
    });

    expect(uploadButton.textContent).toBe("");
    expect(uploadButton.className).toContain("bg-[#8E51FF]");
    expect(uploadButton.className).toContain("px-0");
    expect(uploadButton.querySelector("svg")).toBeTruthy();
  });

  it("keeps upload confirmation controls visible inside the dialog viewport", async () => {
    const user = userEvent.setup();

    render(renderPanel({ sources: [] }));

    await user.click(screen.getByRole("button", { name: "Upload Document" }));

    const dialog = screen.getByRole("dialog");
    const confirmButton = screen.getByRole("button", { name: "Confirm" });

    expect(dialog.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(dialog.className).toContain("overflow-hidden");
    expect(confirmButton.parentElement?.className).toContain("shrink-0");
    expect(confirmButton.className).toContain("bg-[#8E51FF]");
    expect(confirmButton.className).toContain("border-b-[4px]");
    expect(confirmButton.className).toContain("font-mono-readable");
  });

  it("uses plain product language for empty and upload states", async () => {
    const user = userEvent.setup();

    const { container } = render(renderPanel({ sources: [] }));

    expect(screen.getByRole("heading", { name: "Sources" })).toBeTruthy();
    expect(screen.getAllByText("No sources yet.").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/indexed|indexing|parsing/i);

    cleanup();
    const opened = render(renderPanel({ sources: [] }));
    await user.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(
      screen.getByText(
        /Notebook accepts PDF, DOC, DOCX, TXT, MD, XLS, XLSX, PPTX, images, and more files up to 300 MB/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Max size: 300 MB")).toBeTruthy();
    expect(opened.container.textContent).not.toMatch(/Knowhere|parsing|indexing/i);
  });

  it("separates source opening from query include toggles", async () => {
    const onSelectSource = vi.fn();
    const onToggleIncluded = vi.fn();

    render(
      renderPanel({
        sources: [
          {
            id: "source_1",
            title: "lecture.pdf",
            status: "ready",
            chunkCount: 3,
          },
        ],
        onSelectSource,
        onToggleIncluded,
      }),
    );

    const checkbox = screen.getByRole("checkbox", { name: "Use lecture.pdf in answers" });
    fireEvent.click(checkbox);

    expect(onToggleIncluded).toHaveBeenCalledWith("source_1", false);
    expect(onSelectSource).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Open lecture.pdf parsed chunks" }),
    );

    expect(onSelectSource).toHaveBeenCalledWith("source_1");
    expect(screen.getByText("Processed · 3 chunks")).toBeTruthy();
  });

  it("paginates large source lists", async () => {
    const sources = Array.from({ length: 27 }, (_, index) =>
      makeReadySource(index + 1),
    );

    render(renderPanel({ sources }));

    expect(screen.getByText("source-01.pdf")).toBeTruthy();
    expect(screen.getByText("source-25.pdf")).toBeTruthy();
    expect(screen.queryByText("source-26.pdf")).toBeNull();
    expect(screen.getByText("1-25 of 27")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Next sources page" }),
    );

    expect(screen.queryByText("source-01.pdf")).toBeNull();
    expect(screen.getByText("source-26.pdf")).toBeTruthy();
    expect(screen.getByText("source-27.pdf")).toBeTruthy();
    expect(screen.getByText("26-27 of 27")).toBeTruthy();
  });

  it("moves pagination to the selected source page", async () => {
    const sources = Array.from({ length: 27 }, (_, index) =>
      makeReadySource(index + 1),
    );

    render(
      renderPanel({
        sources,
        selectedSourceId: "source_26",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("source-26.pdf")).toBeTruthy();
    });
    expect(screen.queryByText("source-01.pdf")).toBeNull();
    expect(screen.getByText("26-27 of 27")).toBeTruthy();
  });

  it("hides source actions that are not wired", () => {
    render(
      renderPanel({
        sources: [
          {
            id: "source_1",
            title: "lecture.pdf",
            status: "ready",
            chunkCount: 3,
          },
        ],
      }),
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Use lecture.pdf in answers",
    }) as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Delete lecture.pdf" }),
    ).toBeNull();
  });

  it("confirms source deletion for source rows that are still processing", async () => {
    const user = userEvent.setup();
    const onArchiveSource = vi.fn();

    render(
      renderPanel({
        sources: [
          {
            id: "source_1",
            title: "lecture.pdf",
            status: "parsing",
            chunkCount: 0,
          },
        ],
        onArchiveSource,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Delete lecture.pdf" }));
    expect(screen.getByRole("heading", { name: "Delete document" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onArchiveSource).toHaveBeenCalledWith("source_1");
  });

  it("shows row-level loading while a source archive API action is pending", () => {
    render(
      renderPanel({
        sources: [
          {
            id: "source_1",
            title: "lecture.pdf",
            status: "ready",
            chunkCount: 3,
          },
        ],
        archivingSourceIds: ["source_1"],
        onArchiveSource: vi.fn(),
      }),
    );

    const deleteButton = screen.getByRole("button", {
      name: "Delete lecture.pdf",
    });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    expect(within(deleteButton).getByRole("status", { name: "Loading" }))
      .toBeTruthy();
  });

  it("shows retry actions for failed source rows", () => {
    const onRetrySource = vi.fn();

    render(
      renderPanel({
        sources: [
          {
            id: "source_1",
            title: "lecture.pdf",
            status: "failed",
            failureMessage:
              "Too many concurrent requests (2/2 active). Please retry after 30 seconds.",
            originalFile: {
              url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
              mimeType: "application/pdf",
            },
          },
        ],
        onRetrySource,
        retryingSourceIds: ["source_1"],
      }),
    );

    const retryButton = screen.getByRole("button", {
      name: "Retry lecture.pdf processing",
    });
    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(
        "Too many concurrent requests (2/2 active). Please retry after 30 seconds.",
      ),
    ).toBeTruthy();
  });

  it("uploads selected files through the sources API", async () => {
    const user = userEvent.setup();
    const uploadedSource = {
      id: "source_1",
      title: "notes.pdf",
      status: "parsing",
      mimeType: "application/pdf",
      originalFile: {
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        mimeType: "application/pdf",
      },
    };
    let requestBody: unknown = null;
    mocks.uploadBlob.mockResolvedValue(makeUploadedBlob());
    vi.stubGlobal("crypto", { randomUUID: () => "upload_1" });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://localhost").toString(), init);
      expect(getRequestPath(request)).toBe("/api/sources");
      expect(request.method).toBe("POST");
      requestBody = await request.json();
      return Response.json({ source: uploadedSource }, { status: 201 });
    });
    const onSourceUploaded = vi.fn();
    vi.stubGlobal("fetch", fetch);

    render(React.createElement(C, { sources: [], onSourceUploaded }));

    await user.click(screen.getByRole("button", { name: "Upload Document" }));
    const input = document.querySelector("input[type='file']");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Upload input was not rendered.");
    }

    await user.upload(
      input,
      new File(["hello"], "notes.pdf", { type: "application/pdf" }),
    );
    const form = document.querySelector("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Upload form was not rendered.");
    }
    fireEvent.submit(form);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(mocks.uploadBlob).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
      expect.objectContaining({ name: "notes.pdf" }),
      expect.objectContaining({
        access: "public",
        contentType: "application/pdf",
        handleUploadUrl: "/api/source-uploads/blob",
        multipart: true,
      }),
    );
    expect(requestBody).toEqual({
      upload: {
        type: "blob",
        pathname: "source-uploads/upload_1/document.pdf",
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        fileName: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
      },
    });
    await waitFor(() =>
      expect(onSourceUploaded).toHaveBeenCalledWith(uploadedSource),
    );
  });

  it("accepts dropped files in the upload dialog without browser navigation", async () => {
    const user = userEvent.setup();
    const uploadedSource = {
      id: "source_1",
      title: "drop.pdf",
      status: "parsing",
      mimeType: "application/pdf",
    };
    let requestBody: unknown = null;
    mocks.uploadBlob.mockResolvedValue(makeUploadedBlob());
    vi.stubGlobal("crypto", { randomUUID: () => "upload_1" });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const request = input instanceof Request
          ? input
          : new Request(new URL(String(input), "http://localhost").toString(), init);
        expect(getRequestPath(request)).toBe("/api/sources");
        requestBody = await request.json();
        return Response.json({ source: uploadedSource }, { status: 201 });
      }),
    );
    const onSourceUploaded = vi.fn();

    render(React.createElement(C, { sources: [], onSourceUploaded }));

    await user.click(screen.getByRole("button", { name: "Upload Document" }));
    const dialog = screen.getByRole("dialog");
    const file = new File(["hello"], "drop.pdf", { type: "application/pdf" });
    const dropEvent = createFileDropEvent(file);

    await act(async () => {
      dialog.dispatchEvent(dropEvent);
    });

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(await screen.findByText("Selected: drop.pdf")).toBeTruthy();

    const form = document.querySelector("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Upload form was not rendered.");
    }
    fireEvent.submit(form);

    await waitFor(() =>
      expect(onSourceUploaded).toHaveBeenCalledWith(uploadedSource),
    );
    expect(requestBody).toEqual({
      upload: {
        type: "blob",
        pathname: "source-uploads/upload_1/document.pdf",
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        fileName: "drop.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
      },
    });
  });

  it("shows upload API failures inside the upload dialog", async () => {
    const user = userEvent.setup();
    mocks.uploadBlob.mockResolvedValue(makeUploadedBlob());
    vi.stubGlobal("crypto", { randomUUID: () => "upload_1" });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (getRequestPath(input) === "/api/source-uploads/blob") {
        return Response.json({ ok: true }, { status: 200 });
      }

      return Response.json(
        { message: fileTooLargeMessage },
        { status: 400 },
      );
    });
    vi.stubGlobal("fetch", fetch);

    render(renderPanel({ sources: [] }));

    await user.click(screen.getByRole("button", { name: "Upload Document" }));
    const input = document.querySelector("input[type='file']");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Upload input was not rendered.");
    }

    await user.upload(
      input,
      new File(["hello"], "large.pdf", { type: "application/pdf" }),
    );
    const form = document.querySelector("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Upload form was not rendered.");
    }
    fireEvent.submit(form);

    expect(await screen.findByText(fileTooLargeMessage)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
  });
});

function getRequestPath(input: RequestInfo | URL): string {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return new URL(url, "http://localhost").pathname;
}

function makeReadySource(index: number): {
  readonly chunkCount: number;
  readonly documentId: string;
  readonly id: string;
  readonly mimeType: string;
  readonly status: "ready";
  readonly title: string;
} {
  const suffix = String(index).padStart(2, "0");
  return {
    chunkCount: index,
    documentId: `doc_${index}`,
    id: `source_${index}`,
    mimeType: "application/pdf",
    status: "ready",
    title: `source-${suffix}.pdf`,
  };
}

function makeUploadedBlob(): {
  readonly url: string;
  readonly downloadUrl: string;
  readonly pathname: string;
  readonly contentType: string;
  readonly contentDisposition: string;
  readonly etag: string;
} {
  return {
    url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
    downloadUrl:
      "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf?download=1",
    pathname: "source-uploads/upload_1/document.pdf",
    contentType: "application/pdf",
    contentDisposition: 'attachment; filename="document.pdf"',
    etag: "etag_1",
  };
}

function createFileDropEvent(file: File): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  const files: Pick<FileList, "length" | "item"> & { readonly 0: File } = {
    0: file,
    length: 1,
    item: (index: number): File | null => (index === 0 ? file : null),
  };
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files,
      types: ["Files"],
    },
  });
  return event;
}
