// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => ({
  upload: mocks.uploadBlob,
}));

import { SourceUploadDialog } from "./source-upload-dialog";

describe("SourceUploadDialog", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("accepts dropped files without browser navigation and reports uploaded sources", async () => {
    const user = userEvent.setup();
    const uploadedSource = {
      id: "source_1",
      title: "drop.pdf",
      status: "parsing",
      mimeType: "application/pdf",
    };
    mocks.uploadBlob.mockResolvedValue(makeUploadedBlob());
    vi.stubGlobal("crypto", { randomUUID: () => "upload_1" });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(Response.json({ source: uploadedSource }, { status: 201 })),
      ),
    );
    const onSourceUploaded = vi.fn();

    render(React.createElement(SourceUploadDialog, { onSourceUploaded }));

    await user.click(screen.getByRole("button", { name: "Upload Document" }));
    const dialog = screen.getByRole("dialog");
    const file = new File(["hello"], "drop.pdf", { type: "application/pdf" });
    const dropEvent = createFileDropEvent(file);

    await act(async () => {
      dialog.dispatchEvent(dropEvent);
    });

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(await screen.findByText("Selected: drop.pdf")).toBeTruthy();
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(onSourceUploaded).toHaveBeenCalledWith(uploadedSource),
    );
  });
});

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
