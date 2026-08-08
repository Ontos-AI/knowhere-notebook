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
  trackNotebookUploadButtonClicked: vi.fn(),
  trackNotebookDocumentUploadCompleted: vi.fn(),
  trackNotebookDocumentUploadFailed: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => ({
  upload: mocks.uploadBlob,
}));

vi.mock("@/lib/posthog", () => ({
  trackNotebookUploadButtonClicked: mocks.trackNotebookUploadButtonClicked,
  trackNotebookDocumentUploadCompleted:
    mocks.trackNotebookDocumentUploadCompleted,
  trackNotebookDocumentUploadFailed: mocks.trackNotebookDocumentUploadFailed,
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
    expect(mocks.trackNotebookUploadButtonClicked).toHaveBeenCalledOnce();
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

  it("uploads directly without Blob and targets the chosen namespace workspace", async () => {
    const user = userEvent.setup();
    const uploadedSource = {
      id: "source_1",
      title: "direct.pdf",
      status: "parsing",
      mimeType: "application/pdf",
    };
    const requests: Array<{
      readonly path: string;
      readonly body: unknown;
    }> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(
              new URL(String(input), "http://localhost").toString(),
              init,
            );
      const path = new URL(request.url).pathname;
      if (path === "/api/api-keys/key_1/namespaces") {
        return Response.json({
          namespaces: [{ namespace: "default" }, { namespace: "adobe" }],
        });
      }
      if (path === "/api/workspaces" && request.method === "POST") {
        const body = (await request.json()) as { namespace?: string };
        return Response.json({
          workspace: {
            id: "workspace_adobe",
            namespace: body.namespace,
          },
        });
      }
      if (path === "/api/sources" && request.method === "POST") {
        const body = await request.formData();
        requests.push({ path, body });
        return Response.json({ source: uploadedSource }, { status: 201 });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const onSourceUploaded = vi.fn();

    render(
      React.createElement(SourceUploadDialog, {
        onSourceUploaded,
        isBlobConfigured: false,
        activeWorkspace: { id: "workspace_default", namespace: "default" },
        knowhereKeyLabels: [{ id: "key_1", label: "Key 1" }],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Upload Document" }));
    const dropdown = (await screen.findByTestId(
      "upload-target-namespace",
    )) as HTMLSelectElement;
    await waitFor(() => expect(dropdown.options.length).toBe(2));

    await user.selectOptions(dropdown, "key_1::adobe");
    const file = new File(["hello"], "direct.pdf", { type: "application/pdf" });
    await user.upload(
      document.querySelector("input[type='file']") as HTMLInputElement,
      file,
    );
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(onSourceUploaded).toHaveBeenCalledWith(uploadedSource),
    );
    expect(mocks.uploadBlob).not.toHaveBeenCalled();
    // The workspace is created for the chosen namespace, then the upload
    // targets it via the multipart workspaceId field.
    const uploadRequest = requests.find(
      (request) => request.path === "/api/sources",
    );
    expect(uploadRequest).toBeTruthy();
    expect((uploadRequest?.body as FormData).get("workspaceId")).toBe(
      "workspace_adobe",
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
