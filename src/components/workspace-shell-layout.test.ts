// @vitest-environment jsdom
import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { WorkspaceShellLayout } from "./workspace-shell-layout"
import { workspaceShellState } from "./workspace-shell-state"

const C = WorkspaceShellLayout as React.FC<Record<string, unknown>>

describe("WorkspaceShellLayout", () => {
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
        isGuest: false,
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
        onDesktopPanelResize: vi.fn(),
        onDesktopPanelResizeEnd: vi.fn(),
        onDesktopPanelResizeStart: vi.fn(),
        onLoadMoreChunks: vi.fn(),
        onLoginClick: vi.fn(),
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
    expect(screen.getByTestId("desktop-chat-panel").style.width).toBe("420px")
  })
})
