// @vitest-environment jsdom
import React, { type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackNotebookDocumentUploadCompleted: vi.fn(),
  trackNotebookDocumentUploadFailed: vi.fn(),
}));

vi.mock("@/lib/posthog", () => ({
  trackNotebookDocumentUploadCompleted:
    mocks.trackNotebookDocumentUploadCompleted,
  trackNotebookDocumentUploadFailed: mocks.trackNotebookDocumentUploadFailed,
}));

import type { SourceView } from "@/domains/sources/types";
import { useSourceUploadDialogWorkflow } from "./source-upload-dialog-workflow";

type UploadSourceResult = {
  readonly status: number;
  readonly body: {
    readonly message?: string;
    readonly source?: SourceView;
  };
};

describe("useSourceUploadDialogWorkflow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uploads the selected file, reports the Source, closes the dialog, and clears selection", async () => {
    const uploadedSource: SourceView = {
      id: "source_1",
      title: "notes.pdf",
      mimeType: "application/pdf",
      status: "parsing",
    };
    const uploadSource = vi.fn(async () => ({
      status: 201,
      body: { source: uploadedSource },
    }));
    const onSourceUploaded = vi.fn();
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });

    render(
      React.createElement(SourceUploadDialogWorkflowHarness, {
        onSourceUploaded,
        uploadSource,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "open-dialog" }));
    fireEvent.change(screen.getByLabelText("file-input"), {
      target: { files: [file] },
    });
    expect(screen.getByTestId("selected-file-name").textContent).toBe("notes.pdf");

    fireEvent.submit(screen.getByTestId("upload-form"));

    await waitFor(() => {
      expect(onSourceUploaded).toHaveBeenCalledWith(uploadedSource);
    });
    expect(uploadSource).toHaveBeenCalledWith(file, true, undefined);
    expect(mocks.trackNotebookDocumentUploadCompleted).toHaveBeenCalledWith({
      context: undefined,
      uploadedCount: 1,
      fileType: "application/pdf",
      fileSizeBytes: 5,
      sourceCountBefore: 0,
      sourceCountAfter: 1,
    });
    expect(screen.getByTestId("is-dialog-open").textContent).toBe("false");
    expect(screen.getByTestId("selected-file-name").textContent).toBe("");
  });

  it("prevents duplicate submissions while an upload is in flight", async () => {
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    let resolveUpload: (value: UploadSourceResult) => void = () => {
      throw new Error("Upload promise resolver was not initialized.");
    };
    const uploadSource = vi.fn(
      () =>
        new Promise<UploadSourceResult>((resolve) => {
          resolveUpload = resolve;
        }),
    );

    render(
      React.createElement(SourceUploadDialogWorkflowHarness, {
        uploadSource,
      }),
    );

    fireEvent.change(screen.getByLabelText("file-input"), {
      target: { files: [file] },
    });
    fireEvent.submit(screen.getByTestId("upload-form"));
    await waitFor(() => {
      expect(screen.getByTestId("is-uploading").textContent).toBe("true");
    });

    fireEvent.submit(screen.getByTestId("upload-form"));

    expect(uploadSource).toHaveBeenCalledTimes(1);
    resolveUpload({
      status: 201,
      body: {
        source: {
          id: "source_1",
          title: "notes.pdf",
          mimeType: "application/pdf",
          status: "parsing",
        },
      },
    });
  });

  it("shows a friendly validation message when no file is selected", async () => {
    const uploadSource = vi.fn();

    render(
      React.createElement(SourceUploadDialogWorkflowHarness, {
        uploadSource,
      }),
    );

    fireEvent.submit(screen.getByTestId("upload-form"));

    expect(uploadSource).not.toHaveBeenCalled();
    expect(screen.getByTestId("upload-message").textContent).toBe(
      "Choose a document to upload.",
    );
  });

  it("classifies local upload validation failures separately from server failures", async () => {
    const uploadSource = vi.fn(async () => ({
      status: 400,
      body: { message: "Unsupported file type." },
    }));
    const file = new File(["hello"], "notes.exe", {
      type: "application/x-msdownload",
    });

    render(
      React.createElement(SourceUploadDialogWorkflowHarness, {
        uploadSource,
      }),
    );

    fireEvent.change(screen.getByLabelText("file-input"), {
      target: { files: [file] },
    });
    fireEvent.submit(screen.getByTestId("upload-form"));

    await waitFor(() => {
      expect(mocks.trackNotebookDocumentUploadFailed).toHaveBeenCalledWith({
        context: undefined,
        fileType: "application/x-msdownload",
        fileSizeBytes: 5,
        errorType: "validation",
        errorMessage: "Unsupported file type.",
      });
    });
    expect(screen.getByTestId("upload-message").textContent).toBe(
      "Unsupported file type.",
    );
  });
});

function SourceUploadDialogWorkflowHarness({
  onSourceUploaded,
  uploadSource,
}: {
  readonly onSourceUploaded?: (source: SourceView) => void;
  readonly uploadSource: (file: File) => Promise<UploadSourceResult>;
}): ReactElement {
  const {
    inputRef,
    isDialogOpen,
    isUploading,
    message,
    selectedFileName,
    handleFileInputChange,
    handleSubmit,
    handleUploadDialogOpen,
  } = useSourceUploadDialogWorkflow({
    onSourceUploaded,
    uploadSource,
  });

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "button",
      {
        type: "button",
        onClick: handleUploadDialogOpen,
      },
      "open-dialog",
    ),
    React.createElement(
      "form",
      {
        "data-testid": "upload-form",
        onSubmit: handleSubmit,
      },
      React.createElement("input", {
        "aria-label": "file-input",
        ref: inputRef,
        type: "file",
        onChange: handleFileInputChange,
      }),
      React.createElement("button", { type: "submit" }, "submit"),
    ),
    React.createElement(
      "div",
      { "data-testid": "is-dialog-open" },
      String(isDialogOpen),
    ),
    React.createElement(
      "div",
      { "data-testid": "is-uploading" },
      String(isUploading),
    ),
    React.createElement(
      "div",
      { "data-testid": "selected-file-name" },
      selectedFileName ?? "",
    ),
    React.createElement(
      "div",
      { "data-testid": "upload-message" },
      message?.text ?? "",
    ),
  );
}
