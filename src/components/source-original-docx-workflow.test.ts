// @vitest-environment jsdom
import React, { type ReactElement } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SourceOriginalFileView } from "@/domains/sources/types"
import { sourceOriginalPreviewRequest } from "./source-original-preview-request"
import { useSourceOriginalDocxWorkflow } from "./source-original-docx-workflow"

const docxRenderOptionsLog: unknown[] = []
const mammothConvertLog: unknown[] = []
let shouldRejectDocxPreviewRender = false

vi.mock("docx-preview", () => ({
  renderAsync: vi.fn(
    (
      _data: ArrayBuffer,
      container: HTMLElement,
      _styleContainer: HTMLElement | undefined,
      options: unknown,
    ) => {
      docxRenderOptionsLog.push(options)
      container.innerHTML = "<p>Primary DOCX</p>"
      return shouldRejectDocxPreviewRender
        ? Promise.reject(new Error("docx-preview failed"))
        : Promise.resolve()
    },
  ),
}))

vi.mock("mammoth", () => ({
  default: {
    convertToHtml: vi.fn((input: unknown) => {
      mammothConvertLog.push(input)
      return Promise.resolve({
        value: "<h1>Fallback DOCX</h1><script>alert('x')</script>",
        messages: [],
      })
    }),
  },
}))

describe("useSourceOriginalDocxWorkflow", () => {
  afterEach(() => {
    cleanup()
    sourceOriginalPreviewRequest.clearCacheForTests()
    vi.unstubAllGlobals()
    shouldRejectDocxPreviewRender = false
    docxRenderOptionsLog.length = 0
    mammothConvertLog.length = 0
  })

  it("renders DOCX data into the container with fluid page width options", async () => {
    stubArrayBufferFetch()

    render(React.createElement(DocxWorkflowHarness, { file: makeDocxFile() }))

    await waitFor(() => {
      expect(screen.getByTestId("docx-status").textContent).toBe("ready")
    })
    expect(screen.getByTestId("docx-container").textContent).toContain(
      "Primary DOCX",
    )
    expect(docxRenderOptionsLog[0]).toMatchObject({ ignoreWidth: true })
  })

  it("falls back to sanitized mammoth HTML when docx-preview cannot render", async () => {
    shouldRejectDocxPreviewRender = true
    stubArrayBufferFetch()

    render(React.createElement(DocxWorkflowHarness, { file: makeDocxFile() }))

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Fallback DOCX" })).toBeTruthy()
    })
    expect(mammothConvertLog).toHaveLength(1)
    expect(document.querySelector("script")).toBeNull()
  })

  it("leaves shared DOCX requests uncancelled on cleanup", async () => {
    const signals: Array<AbortSignal | undefined> = []
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        signals.push(init?.signal ?? undefined)
        return new Promise<Response>(() => undefined)
      }),
    )

    const { unmount } = render(
      React.createElement(DocxWorkflowHarness, { file: makeDocxFile() }),
    )
    await waitFor(() => {
      expect(signals).toHaveLength(1)
    })

    unmount()

    expect(signals[0]).toBeUndefined()
  })
})

function DocxWorkflowHarness({
  file,
}: {
  readonly file: SourceOriginalFileView
}): ReactElement {
  const { containerRef, status } = useSourceOriginalDocxWorkflow({ file })

  return React.createElement(
    React.Fragment,
    null,
    React.createElement("div", { "data-testid": "docx-status" }, status.status),
    React.createElement("div", {
      "data-testid": "docx-container",
      ref: containerRef,
    }),
  )
}

function makeDocxFile(): SourceOriginalFileView {
  return {
    url: "https://example.com/report.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }
}

function stubArrayBufferFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
      ),
    ),
  )
}
