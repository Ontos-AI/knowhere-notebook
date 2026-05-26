// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceOriginalTextPreview } from "./source-original-text-preview";

describe("SourceOriginalTextPreview", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders generated Markdown tables after normalizing break tags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            "Service | Key Family<br>--- | ---<br>OpenAI | API key",
            { status: 200 },
          ),
        ),
      ),
    );

    render(
      React.createElement(SourceOriginalTextPreview, {
        file: {
          url: "https://example.com/secret-fingerprint-report.md",
          mimeType: "text/markdown",
        },
        variant: "markdown",
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeTruthy();
    });
    expect(screen.queryByText(/<br>/)).toBeNull();
  });

  it("leaves shared text downloads uncancelled when the preview unmounts", async () => {
    const fetchSignals: Array<AbortSignal | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        fetchSignals.push(init?.signal ?? undefined);
        return new Promise<Response>(() => undefined);
      }),
    );

    const { unmount } = render(
      React.createElement(SourceOriginalTextPreview, {
        file: {
          url: "https://example.com/notes.txt",
          mimeType: "text/plain",
        },
        variant: "text",
      }),
    );

    await waitFor(() => {
      expect(fetchSignals).toHaveLength(1);
    });
    unmount();

    expect(fetchSignals[0]).toBeUndefined();
  });
});
