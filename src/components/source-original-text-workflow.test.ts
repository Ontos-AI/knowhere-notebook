// @vitest-environment jsdom
import React, { type ReactElement } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SourceOriginalFileView } from "@/domains/sources/types"
import { useSourceOriginalTextWorkflow } from "./source-original-text-workflow"

describe("useSourceOriginalTextWorkflow", () => {
  afterEach(() => {
    cleanup()
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

  it("aborts in-flight text requests on cleanup", async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        if (init?.signal instanceof AbortSignal) signals.push(init.signal)
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"))
          })
        })
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

    expect(signals[0]?.aborted).toBe(true)
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
