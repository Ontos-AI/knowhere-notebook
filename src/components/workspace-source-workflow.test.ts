// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SourceView } from "@/domains/sources/types"

const mocks = vi.hoisted(() => ({
  archiveSource: vi.fn(),
  fetchSources: vi.fn(),
  retrySource: vi.fn(),
}))

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    keys: {
      archiveSource: "archive-source",
      retrySource: "retry-source",
      sources: "/api/sources",
    },
    archiveSource: mocks.archiveSource,
    fetchSources: mocks.fetchSources,
    retrySource: mocks.retrySource,
  },
}))

import { useWorkspaceSourceWorkflow } from "./workspace-source-workflow"

describe("useWorkspaceSourceWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("archives the selected Source and clears its query exclusion state", async () => {
    const initialSources = [
      makeSource({ id: "source_1", title: "Selected" }),
      makeSource({ id: "source_2", title: "Remaining" }),
    ]
    mocks.archiveSource.mockResolvedValue({ id: "source_1", archived: true })
    mocks.fetchSources.mockResolvedValue(initialSources)

    const { result } = renderWorkspaceSourceWorkflow({
      initialSources,
    })

    act(() => {
      result.current.handleToggleIncluded("source_1", false)
    })
    expect(result.current.sources[0]?.excludedFromQuery).toBe(true)

    await act(async () => {
      await result.current.handleArchiveSource("source_1")
    })

    expect(mocks.archiveSource).toHaveBeenCalledWith("source_1")
    await waitFor(() => {
      expect(result.current.selectedSourceId).toBe("source_2")
    })
    expect(result.current.sources.map((source) => source.id)).toEqual([
      "source_2",
    ])
    expect(result.current.archivingSourceIds).toEqual([])
  })

  it("upserts uploaded Sources and refreshes Source rows through the workflow", async () => {
    const initialSource = makeSource({ id: "source_1", title: "Existing" })
    const uploadedSource = makeSource({
      id: "source_uploaded",
      title: "Uploaded",
      status: "parsing",
    })
    mocks.fetchSources.mockResolvedValue([uploadedSource, initialSource])

    const { result } = renderWorkspaceSourceWorkflow({
      initialSources: [initialSource],
    })

    act(() => {
      result.current.handleSourceUploaded(uploadedSource)
    })

    await waitFor(() => {
      expect(result.current.sources[0]?.id).toBe("source_uploaded")
    })
    expect(result.current.sources.map((source) => source.id)).toEqual([
      "source_uploaded",
      "source_1",
    ])
    expect(mocks.fetchSources).toHaveBeenCalled()
  })

  it("retries a failed Source and upserts the returned parsing row", async () => {
    const failedSource = makeSource({
      id: "source_1",
      status: "failed",
      failureMessage:
        "Too many concurrent requests (2/2 active). Please retry after 30 seconds.",
    })
    const parsingSource = makeSource({
      id: "source_1",
      status: "parsing",
      failureMessage: undefined,
    })
    let resolveRetry:
      | ((source: SourceView) => void)
      | undefined
    const retryPromise = new Promise<SourceView>((resolve) => {
      resolveRetry = resolve
    })
    mocks.fetchSources.mockResolvedValue([parsingSource])
    mocks.retrySource.mockReturnValue(retryPromise)

    const { result } = renderWorkspaceSourceWorkflow({
      initialSources: [failedSource],
    })

    let retryAction: Promise<void> | undefined
    act(() => {
      retryAction = result.current.handleRetrySource("source_1")
    })
    await waitFor(() => {
      expect(result.current.retryingSourceIds).toEqual(["source_1"])
    })
    await act(async () => {
      resolveRetry?.(parsingSource)
      await retryAction
    })

    expect(mocks.retrySource).toHaveBeenCalledWith("source_1")
    await waitFor(() => {
      expect(result.current.sources[0]).toMatchObject({
        id: "source_1",
        status: "parsing",
      })
    })
    expect(result.current.retryingSourceIds).toEqual([])
  })

  it("refreshes immediately on mount when initial Sources are pending", async () => {
    const parsingSource = makeSource({
      id: "source_parsing",
      status: "parsing",
    })
    const readySource = makeSource({
      id: "source_parsing",
      status: "ready",
      documentId: "document_1",
    })
    mocks.fetchSources.mockResolvedValue([readySource])

    const { result } = renderWorkspaceSourceWorkflow({
      initialSources: [parsingSource],
    })

    await waitFor(() => {
      expect(mocks.fetchSources).toHaveBeenCalledTimes(1)
    })
    expect(result.current.sources[0]).toMatchObject({
      id: "source_parsing",
      status: "ready",
      documentId: "document_1",
    })
  })
})

function renderWorkspaceSourceWorkflow(input: {
  readonly initialSources: readonly SourceView[]
}) {
  return renderHook(() => useWorkspaceSourceWorkflow(input), {
    wrapper: ({ children }: { readonly children: ReactNode }) =>
      createElement(
        SWRConfig,
        { value: { provider: () => new Map() } },
        children,
      ),
  })
}

function makeSource(overrides: Partial<SourceView> = {}): SourceView {
  return {
    id: "source_1",
    title: "Source",
    status: "ready",
    mimeType: "text/plain",
    excludedFromQuery: false,
    ...overrides,
  }
}
