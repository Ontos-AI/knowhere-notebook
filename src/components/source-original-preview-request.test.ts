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

  it("passes cancellation signals to the underlying request", async () => {
    const fetchSignals: Array<AbortSignal | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        fetchSignals.push(init?.signal ?? null);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );
    const controller = new AbortController();

    const request = sourceOriginalPreviewRequest
      .getText("https://example.com/notes.txt", controller.signal)
      .catch(() => undefined);
    await Promise.resolve();
    controller.abort();
    await request;

    expect(fetchSignals[0]?.aborted).toBe(true);
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
