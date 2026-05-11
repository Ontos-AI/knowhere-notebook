import { upload as uploadBlob } from "@vercel/blob/client";

import {
  getSourceUploadBlobPathname,
  SOURCE_UPLOAD_BLOB_HANDLE_PATH,
} from "./blob-upload";
import { stagedUploadWorkflow } from "./staged-upload-workflow";
import type { SourceView } from "@/domains/sources/types";
import { workspaceRouteClient } from "@/domains/workspace/route-client";

type SourceUploadResponseBody = {
  readonly message?: string;
  readonly source?: SourceView;
};

type SourceUploadResponse = {
  readonly status: number;
  readonly body: SourceUploadResponseBody;
};

export async function postSourceUpload(
  file: File,
): Promise<SourceUploadResponse> {
  return postBlobBackedSourceUpload(file);
}

async function postBlobBackedSourceUpload(
  file: File,
): Promise<SourceUploadResponse> {
  return stagedUploadWorkflow.upload(file, {
    cleanupBlob: cleanupSourceBlobUpload,
    getPathname: getSourceUploadBlobPathname,
    postMetadata: postSourceBlobUpload,
    uploadBlob: uploadSourceBlob,
  });
}

async function uploadSourceBlob(input: {
  readonly file: File;
  readonly fileName: string;
  readonly mimeType: string;
  readonly pathname: string;
  readonly sizeBytes: number;
}): Promise<{ readonly pathname: string; readonly url: string }> {
  const blob = await uploadBlob(input.pathname, input.file, {
    access: "public",
    contentType: input.mimeType,
    handleUploadUrl: SOURCE_UPLOAD_BLOB_HANDLE_PATH,
    multipart: true,
    clientPayload: JSON.stringify({
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    }),
  });

  return {
    pathname: blob.pathname,
    url: blob.url,
  };
}

async function postSourceBlobUpload(input: {
  readonly pathname: string;
  readonly url: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}): Promise<SourceUploadResponse> {
  return workspaceRouteClient.postJsonWithStatus<SourceUploadResponseBody>(
    "/api/sources",
    {
      upload: {
        type: "blob",
        pathname: input.pathname,
        url: input.url,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
    },
  );
}

async function cleanupSourceBlobUpload(pathname: string): Promise<void> {
  try {
    await workspaceRouteClient.deleteJson(SOURCE_UPLOAD_BLOB_HANDLE_PATH, {
      pathname,
    });
  } catch {
    // Best-effort cleanup only. The user-facing upload error is handled by the caller.
  }
}
