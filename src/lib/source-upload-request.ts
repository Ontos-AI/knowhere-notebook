import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import { Effect } from "effect";

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
  return Effect.runPromise(
    postSourceUploadEffect(file).pipe(Effect.provide(FetchHttpClient.layer)),
  );
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
