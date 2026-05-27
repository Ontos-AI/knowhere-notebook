import { afterEach, describe, expect, it, vi } from "vitest";

import { sourceOriginalPreviewRequest } from "./source-original-preview-request";

describe("sourceOriginalPreviewRequest", () => {
  afterEach(() => {
    sourceOriginalPreviewRequest.clearCacheForTests();
    vi.unstubAllGlobals();
  });

  it("loads text through the shared HTTP client layer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(new Response("hello", { status: 200 })),
      ),
    );

    const text = await sourceOriginalPreviewRequest.getText(
      "https://example.com/notes.txt",
      new AbortController().signal,
    );

    expect(text).toBe("hello");
  });

  it("loads binary content through the shared HTTP client layer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(new Response(new Uint8Array([1, 2]), { status: 200 })),
      ),
    );

    const data = await sourceOriginalPreviewRequest.getArrayBuffer(
      "https://example.com/report.docx",
      new AbortController().signal,
    );

    expect([...new Uint8Array(data)]).toEqual([1, 2]);
  });

  it("does not bind caller cancellation signals to the shared request", async () => {
    const fetchSignals: Array<AbortSignal | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        fetchSignals.push(init?.signal ?? null);
        return Promise.resolve(new Response("hello", { status: 200 }));
      }),
    );
    const controller = new AbortController();

    const text = await sourceOriginalPreviewRequest.getText(
      "https://example.com/notes.txt",
      controller.signal,
    );
    controller.abort();

    expect(text).toBe("hello");
    expect(fetchSignals[0]).toBeNull();
  });

  it("reuses a warmed binary download for the preview request", async () => {
    const fetchOriginal = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(new Uint8Array([1, 2]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchOriginal);

    sourceOriginalPreviewRequest.prefetchArrayBuffer(
      "https://example.com/report.pdf",
      new AbortController().signal,
    );
    await sourceOriginalPreviewRequest.getArrayBuffer(
      "https://example.com/report.pdf",
      new AbortController().signal,
    );

    expect(fetchOriginal).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared preview download alive when a warmup caller aborts", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchOriginal = vi.fn<typeof globalThis.fetch>((_input, init) => {
      return new Promise<Response>((resolve, reject) => {
        resolveFetch = resolve;
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchOriginal);
    const warmupController = new AbortController();
    const previewController = new AbortController();

    sourceOriginalPreviewRequest.prefetchArrayBuffer(
      "https://example.com/report.pdf",
      warmupController.signal,
    );
    const preview = sourceOriginalPreviewRequest.getArrayBuffer(
      "https://example.com/report.pdf",
      previewController.signal,
    );

    warmupController.abort();
    resolveFetch(new Response(new Uint8Array([1, 2]), { status: 200 }));

    await expect(preview).resolves.toEqual(new Uint8Array([1, 2]).buffer);
    expect(fetchOriginal).toHaveBeenCalledTimes(1);
  });

  it("returns fresh binary buffers from cached downloads", async () => {
    const fetchOriginal = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(new Uint8Array([1, 2]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchOriginal);

    const first = await sourceOriginalPreviewRequest.getArrayBuffer(
      "https://example.com/report.pdf",
      new AbortController().signal,
    );
    const second = await sourceOriginalPreviewRequest.getArrayBuffer(
      "https://example.com/report.pdf",
      new AbortController().signal,
    );

    new Uint8Array(first)[0] = 9;

    expect(first).not.toBe(second);
    expect([...new Uint8Array(second)]).toEqual([1, 2]);
    expect(fetchOriginal).toHaveBeenCalledTimes(1);
  });
});
