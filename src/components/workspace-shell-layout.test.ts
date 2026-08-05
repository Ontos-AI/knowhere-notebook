// @vitest-environment jsdom
import React from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShellLayout } from "./workspace-shell-layout"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
import { workspaceShellState } from "./workspace-shell-state"

const C = WorkspaceShellLayout as React.FC<Record<string, unknown>>

describe("WorkspaceShellLayout", () => {
  afterEach(() => {
    cleanup()
  })

  it("renders desktop workspace panels with stable layout widths", () => {
    render(
      React.createElement(C, {
        archivingSourceIds: [],
        archivingThreadIds: [],
        chat: {
          error: null,
          isLoading: false,
          isSending: false,
          messages: [],
          threadId: null,
        },
        chatThreads: [],
        desktopPanelWidths: workspaceShellState.defaultDesktopPanelWidths,
        focusedChunk: { chunkId: null, requestId: 0 },
        hasMessages: false,
        hasMoreSelectedChunks: false,
        isCreatingThread: false,
        isSelectedAllChunksLoading: false,
        isSelectedChunksLoading: false,
        isSelectedChunksLoadingMore: false,
        loadingThreadId: null,
        minimumDesktopPanelWidth:
          workspaceShellState.getMinimumDesktopPanelWidth(),
        mobilePanel: "chat",
        pendingCitationId: null,
        readySourceCount: 0,
        selectedChunks: [],
        selectedSourceFile: null,
        selectedSourceId: null,
        selectedSourceTitle: null,
        sourceTitlesByDocumentId: {},
        sources: [],
        user: undefined,
        onArchiveChatThread: vi.fn(),
        onArchiveSource: vi.fn(),
        onChatSend: vi.fn(),
        onCitationClick: vi.fn(),
        onCreateChatThread: vi.fn(),
        onDesktopLayoutElementChange: vi.fn(),
        onDesktopPanelElementChange: vi.fn(),
        onDesktopPanelExpand: vi.fn(),
        onDesktopPanelResize: vi.fn(),
        onDesktopPanelResizeEnd: vi.fn(),
        onDesktopPanelResizeStart: vi.fn(),
        onLoadAllChunks: vi.fn(),
        onLoadMoreChunks: vi.fn(),
        onMobilePanelChange: vi.fn(),
        onSelectChatThread: vi.fn(),
        onSourceSelected: vi.fn(),
        onSourceUploaded: vi.fn(),
        onToggleIncluded: vi.fn(),
      }),
    )

    expect(screen.getByTestId("desktop-panel-layout").className).toContain(
      "overflow-x-auto",
    )
    expect(screen.getByTestId("desktop-sources-panel").style.width).toBe(
      "350px",
    )
    expect(screen.getByTestId("desktop-chat-panel").style.width).toBe("800px")
  })

  it("renders compact sidebars when the side panels are collapsed", () => {
    const handleSourceSelected = vi.fn()
    const handleChatThreadSelected = vi.fn()
    const handlePanelExpand = vi.fn()

    render(
      React.createElement(C, {
        archivingSourceIds: [],
        archivingThreadIds: [],
        chat: {
          error: null,
          isLoading: false,
          isSending: false,
          messages: [],
          pendingStatusText: null,
          threadId: null,
        },
        chatThreads: [
          {
            id: "thread_market",
            title: "Market outlook",
            createdAt: "2026-05-26T00:00:00.000Z",
            updatedAt: "2026-05-26T00:00:00.000Z",
          },
        ],
        desktopPanelWidths: {
          sources: workspaceShellState.collapsedDesktopPanelWidth,
          
          chat: workspaceShellState.collapsedDesktopPanelWidth,
        },
        focusedChunk: { chunkId: null, requestId: 0 },
        hasMessages: false,
        hasMoreSelectedChunks: false,
        isCreatingThread: false,
        isSelectedAllChunksLoading: false,
        isSelectedChunksLoading: false,
        isSelectedChunksLoadingMore: false,
        loadingThreadId: null,
        minimumDesktopPanelWidth:
          workspaceShellState.getMinimumDesktopPanelWidth({
            sources: workspaceShellState.collapsedDesktopPanelWidth,
            
            chat: workspaceShellState.collapsedDesktopPanelWidth,
          }),
        mobilePanel: "chat",
        pendingCitationId: null,
        readySourceCount: 0,
        selectedChunks: [],
        selectedSourceFile: null,
        selectedSourceId: null,
        selectedSourceTitle: null,
        sourceTitlesByDocumentId: {},
        sources: [
          {
            id: "source_report",
            title: "Quarterly Report.pdf",
            mimeType: "application/pdf",
            status: "ready",
            documentId: "doc_report",
            chunkCount: 12,
          },
        ],
        user: undefined,
        onArchiveChatThread: vi.fn(),
        onArchiveSource: vi.fn(),
        onChatSend: vi.fn(),
        onCitationClick: vi.fn(),
        onCreateChatThread: vi.fn(),
        onDesktopLayoutElementChange: vi.fn(),
        onDesktopPanelElementChange: vi.fn(),
        onDesktopPanelExpand: handlePanelExpand,
        onDesktopPanelResize: vi.fn(),
        onDesktopPanelResizeEnd: vi.fn(),
        onDesktopPanelResizeStart: vi.fn(),
        onLoadAllChunks: vi.fn(),
        onLoadMoreChunks: vi.fn(),
        onMobilePanelChange: vi.fn(),
        onSelectChatThread: handleChatThreadSelected,
        onSourceSelected: handleSourceSelected,
        onSourceUploaded: vi.fn(),
        onToggleIncluded: vi.fn(),
      }),
    )

    expect(screen.getByTestId("desktop-sources-panel").style.width).toBe(
      `${workspaceShellState.collapsedDesktopPanelWidth}px`,
    )
    expect(screen.getByTestId("desktop-chat-panel").style.width).toBe(
      `${workspaceShellState.collapsedDesktopPanelWidth}px`,
    )
    expect(
      screen.getByRole("button", { name: "Show sources panel" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Show chat panel" })).toBeTruthy()

    screen.getByRole("button", { name: "Open source Quarterly Report.pdf" }).click()
    expect(handleSourceSelected).toHaveBeenCalledWith("source_report")

    screen.getByRole("button", { name: "Open chat Market outlook" }).click()
    expect(handleChatThreadSelected).toHaveBeenCalledWith("thread_market")
    expect(handlePanelExpand).toHaveBeenCalledWith("chat")
  })

  it("keeps normal source rows usable at narrow pre-sidebar widths", () => {
    render(
      React.createElement(C, {
        activeWorkspace: { id: "workspace_1", namespace: "adobe" },
        workspaces: [{ id: "workspace_1", namespace: "adobe" }],
        knowhereKeyLabels: [],
        archivingSourceIds: [],
        archivingThreadIds: [],
        chat: {
          error: null,
          isLoading: false,
          isSending: false,
          messages: [],
          pendingStatusText: null,
          threadId: null,
        },
        chatThreads: [],
        desktopPanelWidths: {
          sources: 180,
          
          chat: 180,
        },
        focusedChunk: { chunkId: null, requestId: 0 },
        hasMessages: false,
        hasMoreSelectedChunks: false,
        isCreatingThread: false,
        isSelectedAllChunksLoading: false,
        isSelectedChunksLoading: false,
        isSelectedChunksLoadingMore: false,
        loadingThreadId: null,
        minimumDesktopPanelWidth:
          workspaceShellState.getMinimumDesktopPanelWidth({
            sources: 180,
            
            chat: 180,
          }),
        mobilePanel: "chat",
        pendingCitationId: null,
        readySourceCount: 1,
        selectedChunks: [],
        selectedSourceFile: null,
        selectedSourceId: "source_report",
        selectedSourceTitle: null,
        sourceTitlesByDocumentId: {},
        sources: [
          {
            id: "source_report",
            title: "Very Long Quarterly Report Filename.pdf",
            mimeType: "application/pdf",
            status: "ready",
            documentId: "doc_report",
            chunkCount: 12,
          },
        ],
        user: undefined,
        onArchiveChatThread: vi.fn(),
        onArchiveSource: vi.fn(),
        onChatSend: vi.fn(),
        onCitationClick: vi.fn(),
        onCreateChatThread: vi.fn(),
        onDesktopLayoutElementChange: vi.fn(),
        onDesktopPanelElementChange: vi.fn(),
        onDesktopPanelExpand: vi.fn(),
        onDesktopPanelResize: vi.fn(),
        onDesktopPanelResizeEnd: vi.fn(),
        onDesktopPanelResizeStart: vi.fn(),
        onLoadAllChunks: vi.fn(),
        onLoadMoreChunks: vi.fn(),
        onMobilePanelChange: vi.fn(),
        onSelectChatThread: vi.fn(),
        onSourceSelected: vi.fn(),
        onSourceUploaded: vi.fn(),
        onToggleIncluded: vi.fn(),
      }),
    )

    expect(screen.queryByRole("button", { name: "Show sources panel" }))
      .toBeNull()
    const desktopSourcesPanel = screen.getByTestId("desktop-sources-panel")

    expect(
      within(desktopSourcesPanel).getByRole("button", {
        name: "Open Very Long Quarterly Report Filename.pdf parsed chunks",
      }),
    ).toBeTruthy()
    expect(
      within(desktopSourcesPanel).getByRole("button", {
        name: "Delete Very Long Quarterly Report Filename.pdf",
      }),
    ).toBeTruthy()
  })
})
