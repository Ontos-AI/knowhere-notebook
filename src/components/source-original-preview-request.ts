import { Effect, Schema } from "effect";

export const sourceOriginalPreviewRequest = {
  getArrayBuffer,
  getText,
} as const;

async function getText(url: string, signal: AbortSignal): Promise<string> {
  return Effect.runPromise(getTextEffect(url, signal));
}

async function getArrayBuffer(
  url: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  return Effect.runPromise(getArrayBufferEffect(url, signal));
}

const getTextEffect = Effect.fn("getSourceOriginalText")(
  function* (url: string, signal: AbortSignal) {
    const response = yield* fetchSourceOriginal(url, signal, "Text");
    if (!isSuccessfulStatus(response.status)) {
      return yield* new SourceOriginalPreviewRequestError({
        message: "Text download failed.",
      });
    }

    return yield* Effect.tryPromise({
      try: () => response.text(),
      catch: () =>
        new SourceOriginalPreviewRequestError({
          message: "Text download failed.",
        }),
    });
  },
);

const getArrayBufferEffect = Effect.fn("getSourceOriginalArrayBuffer")(
  function* (url: string, signal: AbortSignal) {
    const response = yield* fetchSourceOriginal(url, signal, "Binary");
    if (!isSuccessfulStatus(response.status)) {
      return yield* new SourceOriginalPreviewRequestError({
        message: "Binary download failed.",
      });
    }

    return yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: () =>
        new SourceOriginalPreviewRequestError({
          message: "Binary download failed.",
        }),
    });
  },
);

const fetchSourceOriginal = Effect.fn("fetchSourceOriginal")(
  function* (url: string, signal: AbortSignal, label: "Binary" | "Text") {
    return yield* Effect.tryPromise({
      try: () => fetch(url, { signal }),
      catch: () =>
        new SourceOriginalPreviewRequestError({
          message: `${label} download failed.`,
        }),
    });
  },
);

class SourceOriginalPreviewRequestError extends Schema.TaggedError<SourceOriginalPreviewRequestError>()(
  "SourceOriginalPreviewRequestError",
  {
    message: Schema.String,
  },
) {}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}
