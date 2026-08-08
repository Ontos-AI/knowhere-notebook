"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { SourceView } from "@/domains/sources/types";
import { postSourceUpload } from "@/domains/sources/upload-request";
import {
  trackNotebookDocumentUploadCompleted,
  trackNotebookDocumentUploadFailed,
  type AnalyticsContext,
} from "@/lib/posthog";

type SourceUploadResponseBody = {
  readonly message?: string;
  readonly source?: SourceView;
};

type SourceUploadResponse = {
  readonly status: number;
  readonly body: SourceUploadResponseBody;
};

type UploadSource = (
  file: File,
  isBlobConfigured: boolean,
  workspaceId?: string,
) => Promise<SourceUploadResponse>;

/** Resolves the workspace the upload should land in (may create it first). */
type ResolveUploadTarget = () => Promise<string | undefined>;

type SourceUploadDialogMessage = {
  readonly isSuccess: boolean;
  readonly text: string;
};

type SourceUploadDialogWorkflowInput = {
  readonly analyticsContext?: AnalyticsContext;
  readonly onSourceUploaded?: (source: SourceView) => void;
  readonly sourceCountBefore?: number;
  readonly isBlobConfigured?: boolean;
  readonly resolveUploadTarget?: ResolveUploadTarget;
  readonly uploadSource?: UploadSource;
};

type SourceUploadDialogWorkflow = {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly isDialogOpen: boolean;
  readonly isUploading: boolean;
  readonly message: SourceUploadDialogMessage | null;
  readonly selectedFileName: string | null;
  readonly handleUploadDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly handleUploadDrop: (event: DragEvent<HTMLElement>) => void;
  readonly handleDialogOpenChange: (open: boolean) => void;
  readonly handleFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly handleUploadDialogOpen: () => void;
};

const defaultUploadFailureMessage =
  "Upload failed. Try again or choose another file.";

export function useSourceUploadDialogWorkflow({
  analyticsContext,
  onSourceUploaded,
  sourceCountBefore = 0,
  isBlobConfigured = true,
  resolveUploadTarget,
  uploadSource = postSourceUpload,
}: SourceUploadDialogWorkflowInput): SourceUploadDialogWorkflow {
  const inputRef = useRef<HTMLInputElement>(null);
  const isUploadingRef = useRef(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<SourceUploadDialogMessage | null>(
    null,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isUploadingRef.current) return;

    const file = selectedFile ?? inputRef.current?.files?.[0] ?? null;
    if (!file || file.size === 0) {
      setMessage({
        isSuccess: false,
        text: "Choose a document to upload.",
      });
      return;
    }

    isUploadingRef.current = true;
    setIsUploading(true);
    setMessage(null);

    try {
      const targetWorkspaceId = resolveUploadTarget
        ? await resolveUploadTarget()
        : undefined;
      const response = await uploadSource(
        file,
        isBlobConfigured,
        targetWorkspaceId,
      );
      const { body } = response;

      if (!isSuccessfulStatus(response.status) || !body.source) {
        void trackNotebookDocumentUploadFailed({
          context: analyticsContext,
          fileType: file.type || null,
          fileSizeBytes: file.size,
          errorType: getUploadFailureErrorType(response.status),
          errorMessage: body.message ?? defaultUploadFailureMessage,
        });
        setMessage({
          isSuccess: false,
          text: body.message ?? defaultUploadFailureMessage,
        });
        return;
      }

      clearSelectedFile();
      void trackNotebookDocumentUploadCompleted({
        context: analyticsContext,
        uploadedCount: 1,
        fileType: file.type,
        fileSizeBytes: file.size,
        sourceCountBefore,
        sourceCountAfter: sourceCountBefore + 1,
      });
      onSourceUploaded?.(body.source);
      setIsDialogOpen(false);
    } catch {
      void trackNotebookDocumentUploadFailed({
        context: analyticsContext,
        fileType: file.type || null,
        fileSizeBytes: file.size,
        errorType: "network",
        errorMessage: defaultUploadFailureMessage,
      });
      setMessage({
        isSuccess: false,
        text: defaultUploadFailureMessage,
      });
    } finally {
      isUploadingRef.current = false;
      setIsUploading(false);
    }
  }

  function handleUploadDragOver(event: DragEvent<HTMLElement>): void {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleUploadDrop(event: DragEvent<HTMLElement>): void {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();

    if (isUploadingRef.current) return;

    const file = event.dataTransfer.files.item(0);
    if (!file) return;

    setSelectedFileState(file);
    setIsDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean): void {
    setIsDialogOpen(open);
  }

  function handleFileInputChange(
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    setSelectedFileState(event.target.files?.[0] ?? null);
  }

  function handleUploadDialogOpen(): void {
    setIsDialogOpen(true);
  }

  function setSelectedFileState(file: File | null): void {
    setSelectedFile(file);
    setSelectedFileName(file?.name ?? null);
    setMessage(null);
  }

  function clearSelectedFile(): void {
    if (inputRef.current) inputRef.current.value = "";
    setSelectedFile(null);
    setSelectedFileName(null);
  }

  return {
    inputRef,
    isDialogOpen,
    isUploading,
    message,
    selectedFileName,
    handleUploadDragOver,
    handleUploadDrop,
    handleDialogOpenChange,
    handleFileInputChange,
    handleSubmit,
    handleUploadDialogOpen,
  };
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function getUploadFailureErrorType(
  status: number,
): "validation" | "server" {
  return status === 400 ? "validation" : "server";
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}
