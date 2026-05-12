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

type SourceUploadResponseBody = {
  readonly message?: string;
  readonly source?: SourceView;
};

type SourceUploadResponse = {
  readonly status: number;
  readonly body: SourceUploadResponseBody;
};

type UploadSource = (file: File) => Promise<SourceUploadResponse>;

type SourceUploadDialogMessage = {
  readonly isSuccess: boolean;
  readonly text: string;
};

type SourceUploadDialogWorkflowInput = {
  readonly onSourceUploaded?: (source: SourceView) => void;
  readonly uploadSource?: UploadSource;
};

type SourceUploadDialogWorkflow = {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly isDialogOpen: boolean;
  readonly isUploading: boolean;
  readonly message: SourceUploadDialogMessage | null;
  readonly selectedFileName: string | null;
  readonly handleDialogDragOver: (event: DragEvent<HTMLDivElement>) => void;
  readonly handleDialogDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly handleDialogOpenChange: (open: boolean) => void;
  readonly handleFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly handleUploadDialogOpen: () => void;
};

const defaultUploadFailureMessage =
  "Upload failed. Try again or choose another file.";

export function useSourceUploadDialogWorkflow({
  onSourceUploaded,
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
      const response = await uploadSource(file);
      const { body } = response;

      if (!isSuccessfulStatus(response.status) || !body.source) {
        setMessage({
          isSuccess: false,
          text: body.message ?? defaultUploadFailureMessage,
        });
        return;
      }

      clearSelectedFile();
      onSourceUploaded?.(body.source);
      setIsDialogOpen(false);
    } catch {
      setMessage({
        isSuccess: false,
        text: defaultUploadFailureMessage,
      });
    } finally {
      isUploadingRef.current = false;
      setIsUploading(false);
    }
  }

  function handleDialogDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDialogDrop(event: DragEvent<HTMLDivElement>): void {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();

    if (isUploadingRef.current) return;

    const file = event.dataTransfer.files.item(0);
    if (!file) return;

    setSelectedFileState(file);
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
    handleDialogDragOver,
    handleDialogDrop,
    handleDialogOpenChange,
    handleFileInputChange,
    handleSubmit,
    handleUploadDialogOpen,
  };
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}
