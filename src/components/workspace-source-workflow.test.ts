// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SourceView } from "@/domains/sources/types"

const mocks = vi.hoisted(() => ({
  archiveSource: vi.fn(),
  fetchSources: vi.fn(),
  materializeDemoSources: vi.fn(),
}))

vi.mock("@/domains/workspace/client", () => ({
  workspaceClient: {
    keys: {
      archiveSource: "archive-source",
      materializeDemoSources: "/api/demo-sources/materialize",
      sources: "/api/sources",
    },
    archiveSource: mocks.archiveSource,
    fetchSources: mocks.fetchSources,
    materializeDemoSources: mocks.materializeDemoSources,
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
      isGuest: false,
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

  it("materializes one Official Library source through the workflow", async () => {
    const demoSource = makeSource({
      id: "demo-spacex-s1",
      kind: "demo",
      demoSourceId: "demo-spacex-s1",
      title: "spacex-s1.pdf",
    })
    const materializedSource = makeSource({
      id: "source_spacex",
      kind: "workspace",
      title: "spacex-s1.pdf",
      documentId: "doc_spacex",
    })
    mocks.fetchSources.mockResolvedValue([demoSource])
    mocks.materializeDemoSources.mockResolvedValue([materializedSource])

    const { result } = renderWorkspaceSourceWorkflow({
      initialSources: [demoSource],
      isGuest: false,
    })

    await act(async () => {
      await expect(
        result.current.handleOfficialLibrarySourceAdd("demo-spacex-s1"),
      ).resolves.toBe(true)
    })

    expect(mocks.materializeDemoSources).toHaveBeenCalledWith({
      demoSourceIds: ["demo-spacex-s1"],
    })
    expect(result.current.sources.map((source) => source.id)).toEqual([
      "source_spacex",
    ])
  })

  it("does not count unmaterialized Official Library sources as chat-ready", () => {
    const librarySource = makeSource({
      id: "demo-spacex-s1",
      kind: "demo",
      demoSourceId: "demo-spacex-s1",
      title: "spacex-s1.pdf",
      officialLibrary: {
        librarySourceId: "financial-spacex-s1",
        categoryId: "financial-reports",
        sourceUrl: "https://example.com/spacex-s1.pdf",
      },
    })

    const { result } = renderWorkspaceSourceWorkflow({
      initialSources: [librarySource],
      isGuest: false,
    })

    expect(result.current.readySourceCount).toBe(0)
  })

  it("reports failed Official Library materialization without changing sources", async () => {
    const demoSource = makeSource({
      id: "demo-spacex-s1",
      kind: "demo",
      demoSourceId: "demo-spacex-s1",
      title: "spacex-s1.pdf",
    })
    mocks.fetchSources.mockResolvedValue([demoSource])
    mocks.materializeDemoSources.mockRejectedValue(new Error("Bad gateway"))

    const { result } = renderWorkspaceSourceWorkflow({
      initialSources: [demoSource],
      isGuest: false,
    })

    await act(async () => {
      await expect(
        result.current.handleOfficialLibrarySourceAdd("demo-spacex-s1"),
      ).resolves.toBe(false)
    })

    expect(result.current.sources.map((source) => source.id)).toEqual([
      "demo-spacex-s1",
    ])
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
