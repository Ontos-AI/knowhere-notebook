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
  isBlobConfigured = true,
  workspaceId?: string,
): Promise<SourceUploadResponse> {
  // Vercel Blob staging is only available when BLOB_READ_WRITE_TOKEN is set
  // (self-hosted deployments usually don't have it). Without it, fall back to
  // a direct multipart upload to /api/sources, which the server always
  // supports.
  return isBlobConfigured
    ? postBlobBackedSourceUpload(file, workspaceId)
    : postDirectFileUpload(file, workspaceId);
}

async function postBlobBackedSourceUpload(
  file: File,
  workspaceId?: string,
): Promise<SourceUploadResponse> {
  return stagedUploadWorkflow.upload(file, {
    cleanupBlob: cleanupSourceBlobUpload,
    getPathname: getSourceUploadBlobPathname,
    postMetadata: (input) => postSourceBlobUpload(input, workspaceId),
    uploadBlob: uploadSourceBlob,
  });
}

async function postDirectFileUpload(
  file: File,
  workspaceId?: string,
): Promise<SourceUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (workspaceId) formData.append("workspaceId", workspaceId);
  return workspaceRouteClient.postFormDataWithStatus<SourceUploadResponseBody>(
    "/api/sources",
    formData,
  );
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

async function postSourceBlobUpload(
  input: {
    readonly pathname: string;
    readonly url: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  },
  workspaceId?: string,
): Promise<SourceUploadResponse> {
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
      ...(workspaceId ? { workspaceId } : {}),
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
