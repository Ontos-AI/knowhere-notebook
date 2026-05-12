import { Effect, Schema } from "effect";

export const sourceOriginalPreviewRequest = {
  clearCacheForTests,
  getArrayBuffer,
  getText,
  prefetchArrayBuffer,
  prefetchText,
} as const;

const textCache = new Map<string, Promise<string>>();
const arrayBufferCache = new Map<string, Promise<Uint8Array>>();

async function getText(url: string, signal: AbortSignal): Promise<string> {
  return getCachedValue(textCache, url, () =>
    Effect.runPromise(getTextEffect(url, signal)),
  );
}

async function getArrayBuffer(
  url: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const bytes = await getCachedValue(arrayBufferCache, url, async () =>
    toUint8Array(await Effect.runPromise(getArrayBufferEffect(url, signal))),
  );
  return copyArrayBuffer(bytes);
}

function prefetchText(url: string, signal: AbortSignal): void {
  void getText(url, signal).catch(() => undefined);
}

function prefetchArrayBuffer(url: string, signal: AbortSignal): void {
  void getArrayBuffer(url, signal).catch(() => undefined);
}

function clearCacheForTests(): void {
  textCache.clear();
  arrayBufferCache.clear();
}

function getCachedValue<T>(
  cache: Map<string, Promise<T>>,
  url: string,
  load: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(url);
  if (cached) return cached;

  const request = load().catch((error: unknown) => {
    cache.delete(url);
    throw error;
  });
  cache.set(url, request);
  return request;
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

function toUint8Array(data: ArrayBuffer): Uint8Array {
  return new Uint8Array(data);
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}
