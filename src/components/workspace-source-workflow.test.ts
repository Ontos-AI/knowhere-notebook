// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SourceView } from "@/domains/sources/types"

const mocks = vi.hoisted(() => ({
  archiveSource: vi.fn(),
  fetchSources: vi.fn(),
}))

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    keys: {
      archiveSource: "archive-source",
      sources: "/api/sources",
    },
    archiveSource: mocks.archiveSource,
    fetchSources: mocks.fetchSources,
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
      isGuest: true,
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
      expect(result.current.selectedSourceId).toBeNull()
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
      isGuest: false,
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
})

function renderWorkspaceSourceWorkflow(input: {
  readonly initialSources: readonly SourceView[]
  readonly isGuest: boolean
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
