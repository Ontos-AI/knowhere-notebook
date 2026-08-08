"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactElement } from "react"
import { usePathname } from "next/navigation"
import { SWRConfig } from "swr"
import {
  WorkspaceShellLayout,
  type PanelId,
} from "@/components/workspace-shell-layout"
import { useWorkspaceDesktopPanels } from "@/components/workspace-desktop-panels"
import { useWorkspaceCitationFocus } from "@/components/workspace-citation-focus"
import { useWorkspaceChatWorkflow } from "@/components/workspace-chat-workflow"
import { useWorkspaceSourceWorkflow } from "@/components/workspace-source-workflow"
import { workspaceShellState } from "@/components/workspace-shell-state"
import {
  identifyUser,
  resetUser,
  trackNotebookWorkspaceFirstDocumentUploaded,
  trackPageView,
  type AnalyticsContext,
} from "@/lib/posthog"
import { workspaceClient } from "@/domains/workspace/client"
import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"

export type { PanelId } from "@/components/workspace-shell-layout"

export const DESKTOP_PANEL_GUTTER_WIDTH =
  workspaceShellState.desktopPanelGutterWidth
export const DESKTOP_PANEL_MIN_WIDTHS =
  workspaceShellState.minimumDesktopPanelWidths

export type WorkspaceShellProps = {
  user?: {
    id: string
    name: string | null
    email: string | null
  }
  workspace?: {
    id: string
    namespace: string
  }
  workspaces?: readonly {
    id: string
    namespace: string
  }[]
  knowhereKeyLabels?: readonly {
    id: string
    label: string
    mask: string
  }[]
  isBlobConfigured?: boolean
  sources?: SourceView[]
  chatThreads?: ChatThreadView[]
  activeChatThreadId?: string | null
  chatMessages?: ChatMessageView[]
  chunkViewDocumentId?: string | null
  initialPrefetchedChunksBySourceId?: Record<string, ParsedChunkView[]>
}

export function WorkspaceShell(props: WorkspaceShellProps): ReactElement {
  const cacheProvider = useMemo(() => () => new Map(), [])

  return (
    <SWRConfig
      value={{
        provider: cacheProvider,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      }}
    >
      <WorkspaceShellContent
        key={props.workspace?.id ?? "no-workspace"}
        {...props}
      />
    </SWRConfig>
  )
}

function WorkspaceShellContent({
  user,
  sources: initialSources,
  chatThreads: initialChatThreads,
  activeChatThreadId,
  chatMessages: initialChatMessages,
  chunkViewDocumentId,
  workspace,
  workspaces,
  knowhereKeyLabels,
  isBlobConfigured,
  initialPrefetchedChunksBySourceId,
}: WorkspaceShellProps): ReactElement {
  const [mobilePanel, setMobilePanel] = useState<PanelId>("chat")
  const [isChunksOverlayVisible, setIsChunksOverlayVisible] = useState(
    Boolean(chunkViewDocumentId),
  )
  const pathname = usePathname()
  const sourceWorkflow = useWorkspaceSourceWorkflow({
    initialSelectedDocumentId: chunkViewDocumentId ?? null,
    initialSources: initialSources ?? [],
  })
  const analyticsContext = useMemo<AnalyticsContext>(
    () => ({
      workspaceId: workspace?.id,
      workspaceNamespace: workspace?.namespace,
      userId: user?.id,
    }),
    [user?.id, workspace?.id, workspace?.namespace],
  )
  const citationFocus = useWorkspaceCitationFocus({
    fetchChunks: workspaceClient.fetchChunks,
    initialPrefetchedChunksBySourceId:
      initialPrefetchedChunksBySourceId ?? undefined,
    onSelectSource: handleCitationSourceSelected,
    selectedSourceId: sourceWorkflow.selectedSourceId,
    sources: sourceWorkflow.sources,
  })
  const chatWorkflow = useWorkspaceChatWorkflow({
    activeChatThreadId: activeChatThreadId ?? null,
    analyticsContext,
    initialChatMessages: initialChatMessages ?? [],
    initialChatThreads: initialChatThreads ?? [],
    sources: sourceWorkflow.sources,
  })
  const {
    desktopPanelWidths,
    minimumDesktopPanelWidth,
    handleDesktopLayoutElementChange,
    handleDesktopPanelElementChange,
    handleDesktopPanelExpand,
    handleDesktopPanelResize,
    handleDesktopPanelResizeEnd,
    handleDesktopPanelResizeStart,
  } = useWorkspaceDesktopPanels()

  const selectedSourceTitle = citationFocus.selectedSource?.title ?? null

  function handleCitationSourceSelected(sourceId: string | null): void {
    sourceWorkflow.setSelectedSourceId(sourceId)
  }

  function handleSourceSelected(sourceId: string | null): void {
    citationFocus.handleSourceSelected(sourceId)
  }

  function handleOpenChunksOverlay(sourceId?: string): void {
    if (sourceId) {
      citationFocus.handleSourceSelected(sourceId)
    }
    setIsChunksOverlayVisible(true)
  }

  function handleCloseChunksOverlay(): void {
    setIsChunksOverlayVisible(false)
  }

  function handleClearChunkFocus(): void {
    citationFocus.requestChunkFocus(null)
  }

  const hasMessages = chatWorkflow.chat.messages.length > 0
  const didTrackFirstDocumentRef = useRef(false)
  const analyticsContextRef = useRef(analyticsContext)
  const userId = user?.id
  const userEmail = user?.email
  const userName = user?.name

  useEffect(() => {
    analyticsContextRef.current = analyticsContext
  }, [analyticsContext])

  useEffect(() => {
    if (!userId) {
      void resetUser()
      return
    }

    void identifyUser({
      id: userId,
      email: userEmail,
      name: userName,
    })
  }, [userEmail, userId, userName])

  useEffect(() => {
    void trackPageView(analyticsContextRef.current)
  }, [pathname])

  function handleSourceUploaded(source: SourceView): void {
    if (!didTrackFirstDocumentRef.current && sourceWorkflow.sources.length === 0) {
      didTrackFirstDocumentRef.current = true
      void trackNotebookWorkspaceFirstDocumentUploaded({
        context: analyticsContext,
      })
    }
    sourceWorkflow.handleSourceUploaded(source)
  }

  return (
    <WorkspaceShellLayout
      archivingSourceIds={sourceWorkflow.archivingSourceIds}
      retryingSourceIds={sourceWorkflow.retryingSourceIds}
      archivingThreadIds={chatWorkflow.archivingThreadIds}
      chat={chatWorkflow.chat}
      chatThreads={chatWorkflow.chatThreads}
      desktopPanelWidths={desktopPanelWidths}
      activeWorkspace={workspace}
      workspaces={workspaces ?? []}
      knowhereKeyLabels={knowhereKeyLabels ?? []}
      isBlobConfigured={isBlobConfigured ?? false}
      citationListViewRequestId={citationFocus.citationListViewRequestId}
      focusedChunk={citationFocus.focusedChunk}
      hasMessages={hasMessages}
      hasMoreSelectedChunks={citationFocus.hasMoreSelectedChunks}
      isChunksOverlayVisible={isChunksOverlayVisible}
      isCreatingThread={chatWorkflow.isCreatingThread}
      isSelectedAllChunksLoading={citationFocus.isSelectedAllChunksLoading}
      isSelectedChunksLoading={citationFocus.isSelectedChunksLoading}
      isSelectedChunksLoadingMore={citationFocus.isSelectedChunksLoadingMore}
      loadingThreadId={chatWorkflow.loadingThreadId}
      minimumDesktopPanelWidth={minimumDesktopPanelWidth}
      mobilePanel={mobilePanel}
      pendingCitationId={citationFocus.pendingCitationId}
      readySourceCount={sourceWorkflow.readySourceCount}
      selectedChunks={citationFocus.selectedChunks}
      selectedSourceFile={citationFocus.selectedSource?.originalFile ?? null}
      selectedSourceId={sourceWorkflow.selectedSourceId}
      selectedSourceTitle={selectedSourceTitle}
      sourceTitlesByDocumentId={sourceWorkflow.sourceTitlesByDocumentId}
      sources={sourceWorkflow.sources}
      user={user}
      analyticsContext={analyticsContext}
      onArchiveChatThread={chatWorkflow.handleArchiveChatThread}
      onArchiveSource={sourceWorkflow.handleArchiveSource}
      onRetrySource={sourceWorkflow.handleRetrySource}
      onChatSend={chatWorkflow.handleChatSend}
      onCitationClick={(citation, citationId) => {
        setIsChunksOverlayVisible(true)
        citationFocus.handleCitationClick(citation, citationId)
      }}
      onCloseChunksOverlay={handleCloseChunksOverlay}
      onClearChunkFocus={handleClearChunkFocus}
      onCreateChatThread={chatWorkflow.handleCreateChatThread}
      onDesktopLayoutElementChange={handleDesktopLayoutElementChange}
      onDesktopPanelElementChange={handleDesktopPanelElementChange}
      onDesktopPanelExpand={handleDesktopPanelExpand}
      onDesktopPanelResize={handleDesktopPanelResize}
      onDesktopPanelResizeEnd={handleDesktopPanelResizeEnd}
      onDesktopPanelResizeStart={handleDesktopPanelResizeStart}
      onLoadAllChunks={citationFocus.handleLoadAllChunks}
      onLoadMoreChunks={citationFocus.handleLoadMoreChunks}
      onOpenChunksOverlay={handleOpenChunksOverlay}
      onMobilePanelChange={setMobilePanel}
      onSelectChatThread={chatWorkflow.handleSelectChatThread}
      onSourceSelected={handleSourceSelected}
      onSourceUploaded={handleSourceUploaded}
      onToggleIncluded={sourceWorkflow.handleToggleIncluded}
    />
  )
}
