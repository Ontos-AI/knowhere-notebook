"use client"

import { useMemo, useState } from "react"
import type { ReactElement } from "react"
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
import { workspaceClient } from "@/domains/workspace/client"
import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type {
  OfficialLibrarySourceView,
  SourceView,
} from "@/domains/sources/types"

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
  officialLibrarySources?: OfficialLibrarySourceView[]
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
  officialLibrarySources,
  chatThreads: initialChatThreads,
  activeChatThreadId,
  chatMessages: initialChatMessages,
  dashboardUrl,
  initialPrefetchedChunksBySourceId,
  isGuest = false,
  loginUrl,
}: WorkspaceShellProps): ReactElement {
  const [mobilePanel, setMobilePanel] = useState<PanelId>(
    isGuest ? "content" : "chat",
  )
  const sourceWorkflow = useWorkspaceSourceWorkflow({
    initialSources: initialSources ?? [],
    isGuest,
  })
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

  async function handleOfficialLibrarySourceAdd(
    demoSourceId: string,
  ): Promise<void> {
    const didMaterialize =
      await sourceWorkflow.handleOfficialLibrarySourceAdd(demoSourceId)
    if (didMaterialize) {
      await chatWorkflow.handleRefreshActiveChatThread()
    }
  }

  const hasMessages = chatWorkflow.chat.messages.length > 0

  return (
    <WorkspaceShellLayout
      archivingSourceIds={sourceWorkflow.archivingSourceIds}
      addingLibrarySourceIds={sourceWorkflow.addingLibrarySourceIds}
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
      officialLibrarySources={officialLibrarySources ?? []}
      user={user}
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
      onOfficialLibrarySourceAdd={handleOfficialLibrarySourceAdd}
      onSourceUploaded={sourceWorkflow.handleSourceUploaded}
      onToggleIncluded={sourceWorkflow.handleToggleIncluded}
    />
  )
}
