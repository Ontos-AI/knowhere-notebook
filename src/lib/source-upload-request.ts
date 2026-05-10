import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import { upload as uploadBlob } from "@vercel/blob/client";
import { Effect } from "effect";

import {
  createSourceBlobUploadInput,
  getSourceUploadBlobPathname,
  shouldStageUploadInBlob,
  SOURCE_UPLOAD_BLOB_HANDLE_PATH,
} from "./source-blob-upload";
import { validateUploadFile } from "./source-validation";
import type { SourceView } from "./types";

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
  if (shouldStageUploadInBlob(file)) {
    return postBlobBackedSourceUpload(file);
  }

  return Effect.runPromise(
    postSourceUploadEffect(file).pipe(Effect.provide(FetchHttpClient.layer)),
  );
}

async function postBlobBackedSourceUpload(
  file: File,
): Promise<SourceUploadResponse> {
  const validation = validateUploadFile(file);
  if (!validation.ok) {
    return {
      status: 400,
      body: { message: validation.message },
    };
  }

  const pathname = getSourceUploadBlobPathname(file);
  const blob = await uploadBlob(pathname, file, {
    access: "private",
    contentType: validation.mimeType,
    handleUploadUrl: SOURCE_UPLOAD_BLOB_HANDLE_PATH,
    multipart: true,
    clientPayload: JSON.stringify({
      fileName: validation.title,
      mimeType: validation.mimeType,
      sizeBytes: file.size,
    }),
  });
  const input = createSourceBlobUploadInput(file, blob.pathname);
  if ("message" in input) {
    await cleanupSourceBlobUpload(blob.pathname);
    return {
      status: 400,
      body: { message: input.message },
    };
  }

  try {
    const response = await Effect.runPromise(
      postSourceBlobUploadEffect(input).pipe(
        Effect.provide(FetchHttpClient.layer),
      ),
    );
    if (!isSuccessfulStatus(response.status)) {
      await cleanupSourceBlobUpload(blob.pathname);
    }
    return response;
  } catch (error) {
    await cleanupSourceBlobUpload(blob.pathname);
    throw error;
  }
}

const postSourceUploadEffect = Effect.fn("postSourceUpload")(
  function* (file: File) {
    const formData: FormData = new FormData();
    formData.set("file", file);

    const response = yield* HttpClientRequest.post(
      resolveSameOriginUrl("/api/sources"),
    ).pipe(
      HttpClientRequest.bodyFormData(formData),
      HttpClient.execute,
    );
    const body: unknown = yield* response.json;

    return {
      status: response.status,
      body: parseSourceUploadResponseBody(body),
    };
  },
);

const postSourceBlobUploadEffect = Effect.fn("postSourceBlobUpload")(
  function* (input: {
    readonly pathname: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }) {
    const request = yield* HttpClientRequest.post(
      resolveSameOriginUrl("/api/sources"),
    ).pipe(
      HttpClientRequest.bodyJson({
        upload: {
          type: "blob",
          pathname: input.pathname,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
        },
      }),
    );
    const response = yield* HttpClient.execute(request);
    const body: unknown = yield* response.json;

    return {
      status: response.status,
      body: parseSourceUploadResponseBody(body),
    };
  },
);

function parseSourceUploadResponseBody(
  body: unknown,
): SourceUploadResponseBody {
  if (!isRecord(body)) return {};

  const message: string | undefined =
    typeof body.message === "string" ? body.message : undefined;
  const source: SourceView | undefined = isSourceView(body.source)
    ? body.source
    : undefined;
  return { message, source };
}

async function cleanupSourceBlobUpload(pathname: string): Promise<void> {
  try {
    const response = await fetch(resolveSameOriginUrl(SOURCE_UPLOAD_BLOB_HANDLE_PATH), {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathname }),
    });
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only. The user-facing upload error is handled by the caller.
  }
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function isSourceView(value: unknown): value is SourceView {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isSourceStatus(value.status)
  );
}

function isSourceStatus(value: unknown): value is SourceView["status"] {
  return (
    value === "uploading" ||
    value === "parsing" ||
    value === "ready" ||
    value === "failed"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveSameOriginUrl(path: string): string {
  const origin: string | undefined = globalThis.location?.origin;
  if (!origin) return path;
  return new URL(path, origin).toString();
}
