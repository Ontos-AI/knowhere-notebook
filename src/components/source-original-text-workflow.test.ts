// @vitest-environment jsdom
import React, { type ReactElement } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SourceOriginalFileView } from "@/domains/sources/types"
import { sourceOriginalPreviewRequest } from "./source-original-preview-request"
import { useSourceOriginalTextWorkflow } from "./source-original-text-workflow"

describe("useSourceOriginalTextWorkflow", () => {
  afterEach(() => {
    cleanup()
    sourceOriginalPreviewRequest.clearCacheForTests()
    vi.unstubAllGlobals()
  })

  it("loads text for the current source original file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(new Response("Notebook text", { status: 200 })),
      ),
    )

    render(
      React.createElement(TextWorkflowHarness, {
        file: makeTextFile("https://example.com/notes.txt"),
      }),
    )

    await waitFor(() => {
      expect(screen.getByTestId("text-status").textContent).toBe("ready")
    })
    expect(screen.getByTestId("text-value").textContent).toBe("Notebook text")
  })

  it("leaves shared text requests uncancelled on cleanup", async () => {
    const signals: Array<AbortSignal | undefined> = []
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        signals.push(init?.signal ?? undefined)
        return new Promise<Response>(() => undefined)
      }),
    )

    const { unmount } = render(
      React.createElement(TextWorkflowHarness, {
        file: makeTextFile("https://example.com/notes.txt"),
      }),
    )

    await waitFor(() => {
      expect(signals).toHaveLength(1)
    })
    unmount()

    expect(signals[0]).toBeUndefined()
  })
})

function TextWorkflowHarness({
  file,
}: {
  readonly file: SourceOriginalFileView
}): ReactElement {
  const state = useSourceOriginalTextWorkflow({ file })

  return React.createElement(
    React.Fragment,
    null,
    React.createElement("div", { "data-testid": "text-status" }, state.status),
    React.createElement(
      "div",
      { "data-testid": "text-value" },
      state.status === "ready" ? state.value : "",
    ),
  )
}

function makeTextFile(url: string): SourceOriginalFileView {
  return {
    url,
    mimeType: "text/plain",
  }
}
