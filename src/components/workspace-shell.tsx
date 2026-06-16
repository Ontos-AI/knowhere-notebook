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
  sources?: SourceView[]
  chatThreads?: ChatThreadView[]
  activeChatThreadId?: string | null
  chatMessages?: ChatMessageView[]
  dashboardUrl?: string
  initialPrefetchedChunksBySourceId?: Record<string, ParsedChunkView[]>
  isGuest?: boolean
  loginUrl?: string
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
      <WorkspaceShellContent {...props} />
    </SWRConfig>
  )
}

function WorkspaceShellContent({
  user,
  sources: initialSources,
  chatThreads: initialChatThreads,
  activeChatThreadId,
  chatMessages: initialChatMessages,
  dashboardUrl,
  workspace,
  initialPrefetchedChunksBySourceId,
  isGuest = false,
  loginUrl,
}: WorkspaceShellProps): ReactElement {
  const [mobilePanel, setMobilePanel] = useState<PanelId>(
    isGuest ? "content" : "chat",
  )
  const pathname = usePathname()
  const sourceWorkflow = useWorkspaceSourceWorkflow({
    initialSources: initialSources ?? [],
    isGuest,
  })
  const analyticsContext = useMemo<AnalyticsContext>(
    () => ({
      workspaceId: workspace?.id,
      workspaceNamespace: workspace?.namespace,
      userId: user?.id,
      isGuest,
    }),
    [isGuest, user?.id, workspace?.id, workspace?.namespace],
  )
  const citationFocus = useWorkspaceCitationFocus({
    fetchChunks: workspaceClient.fetchChunks,
    initialPrefetchedChunksBySourceId:
      initialPrefetchedChunksBySourceId ?? undefined,
    onSelectSource: sourceWorkflow.setSelectedSourceId,
    selectedSourceId: sourceWorkflow.selectedSourceId,
    sources: sourceWorkflow.sources,
  })
  const chatWorkflow = useWorkspaceChatWorkflow({
    activeChatThreadId: activeChatThreadId ?? null,
    analyticsContext,
    initialChatMessages: initialChatMessages ?? [],
    initialChatThreads: initialChatThreads ?? [],
    isGuest,
    onSourcesMaterialized: sourceWorkflow.handleSourcesMaterialized,
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

  function redirectToLogin(): void {
    window.location.href = loginUrl ?? "/login"
  }

  const selectedSourceTitle = citationFocus.selectedSource?.title ?? null

  function handleSourceSelected(sourceId: string | null): void {
    citationFocus.handleSourceSelected(sourceId)
  }

  const hasMessages = chatWorkflow.chat.messages.length > 0
  const didTrackFirstDocumentRef = useRef(false)

  useEffect(() => {
    if (isGuest || !user) {
      void resetUser()
      return
    }

    void identifyUser({
      id: user.id,
      email: user.email,
      name: user.name,
    })
  }, [isGuest, user?.id, user?.email, user?.name])

  useEffect(() => {
    void trackPageView(pathname, analyticsContext)
  }, [analyticsContext, pathname])

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
      archivingThreadIds={chatWorkflow.archivingThreadIds}
      chat={chatWorkflow.chat}
      chatThreads={chatWorkflow.chatThreads}
      desktopPanelWidths={desktopPanelWidths}
      dashboardUrl={dashboardUrl}
      citationListViewRequestId={citationFocus.citationListViewRequestId}
      focusedChunk={citationFocus.focusedChunk}
      hasMessages={hasMessages}
      hasMoreSelectedChunks={citationFocus.hasMoreSelectedChunks}
      isCreatingThread={chatWorkflow.isCreatingThread}
      isGuest={isGuest}
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
      workspace={workspace}
      analyticsContext={analyticsContext}
      onArchiveChatThread={chatWorkflow.handleArchiveChatThread}
      onArchiveSource={sourceWorkflow.handleArchiveSource}
      onChatSend={chatWorkflow.handleChatSend}
      onCitationClick={citationFocus.handleCitationClick}
      onCreateChatThread={chatWorkflow.handleCreateChatThread}
      onDesktopLayoutElementChange={handleDesktopLayoutElementChange}
      onDesktopPanelElementChange={handleDesktopPanelElementChange}
      onDesktopPanelExpand={handleDesktopPanelExpand}
      onDesktopPanelResize={handleDesktopPanelResize}
      onDesktopPanelResizeEnd={handleDesktopPanelResizeEnd}
      onDesktopPanelResizeStart={handleDesktopPanelResizeStart}
      onLoadAllChunks={citationFocus.handleLoadAllChunks}
      onLoadMoreChunks={citationFocus.handleLoadMoreChunks}
      onLoginClick={redirectToLogin}
      onMobilePanelChange={setMobilePanel}
      onSelectChatThread={chatWorkflow.handleSelectChatThread}
      onSourceSelected={handleSourceSelected}
      onSourceUploaded={handleSourceUploaded}
      onToggleIncluded={sourceWorkflow.handleToggleIncluded}
    />
  )
}
