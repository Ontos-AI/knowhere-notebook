import { useCallback, type ReactElement } from "react"

import { ChatPanel } from "@/components/chat-panel"
import { ChunksPanel } from "@/components/chunks-panel"
import { MobileTabBar } from "@/components/mobile-tab-bar"
import { SourcesPanel } from "@/components/sources-panel"
import { TopNav } from "@/components/top-nav"
import { useWorkspaceResizeHandleWorkflow } from "@/components/workspace-resize-handle-workflow"
import { workspaceShellState } from "@/components/workspace-shell-state"
import type {
  ChatCitationView,
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type {
  SourceOriginalFileView,
  SourceView,
} from "@/domains/sources/types"

export type PanelId = "sources" | "content" | "chat"

type DesktopPanelKey = keyof typeof workspaceShellState.minimumDesktopPanelWidths
type DesktopPanelWidths = Record<DesktopPanelKey, number>

type FocusedChunkState = {
  readonly chunkId: string | null
  readonly requestId: number
}

type WorkspaceShellUser = {
  readonly id: string
  readonly name: string | null
  readonly email: string | null
}

type WorkspaceChatState = {
  readonly threadId: string | null
  readonly messages: ChatMessageView[]
  readonly isSending: boolean
  readonly isLoading: boolean
  readonly error: string | null
  readonly pendingStatusText: string | null
}

export type WorkspaceShellLayoutProps = {
  readonly archivingSourceIds: readonly string[]
  readonly archivingThreadIds: readonly string[]
  readonly chat: WorkspaceChatState
  readonly chatThreads: readonly ChatThreadView[]
  readonly dashboardUrl?: string
  readonly desktopPanelWidths: Readonly<DesktopPanelWidths>
  readonly focusedChunk: FocusedChunkState
  readonly hasMessages: boolean
  readonly hasMoreSelectedChunks: boolean
  readonly isCreatingThread: boolean
  readonly isGuest: boolean
  readonly isSelectedChunksLoading: boolean
  readonly isSelectedChunksLoadingMore: boolean
  readonly loadingThreadId: string | null
  readonly minimumDesktopPanelWidth: number
  readonly mobilePanel: PanelId
  readonly pendingCitationId: string | null
  readonly readySourceCount: number
  readonly selectedChunks: readonly ParsedChunkView[]
  readonly selectedSourceFile: SourceOriginalFileView | null
  readonly selectedSourceId: string | null
  readonly selectedSourceTitle: string | null
  readonly sourceTitlesByDocumentId: Readonly<Record<string, string>>
  readonly sources: readonly SourceView[]
  readonly user: WorkspaceShellUser | undefined
  readonly onArchiveChatThread: (threadId: string) => void | Promise<void>
  readonly onArchiveSource: (sourceId: string) => void | Promise<void>
  readonly onChatSend: (text: string) => void | Promise<void>
  readonly onCitationClick: (
    citation: ChatCitationView,
    citationId: string,
  ) => void | Promise<void>
  readonly onCreateChatThread: () => void | Promise<void>
  readonly onDesktopLayoutElementChange: (element: HTMLDivElement | null) => void
  readonly onDesktopPanelElementChange: (
    panel: DesktopPanelKey,
    element: HTMLDivElement | null,
  ) => void
  readonly onDesktopPanelResize: (
    leftPanel: DesktopPanelKey,
    rightPanel: DesktopPanelKey,
    deltaX: number,
  ) => void
  readonly onDesktopPanelResizeEnd: () => void
  readonly onDesktopPanelResizeStart: (
    leftPanel: DesktopPanelKey,
    rightPanel: DesktopPanelKey,
  ) => void
  readonly onLoadMoreChunks: () => void
  readonly onLoginClick: () => void
  readonly onMobilePanelChange: (panel: PanelId) => void
  readonly onSelectChatThread: (threadId: string) => void
  readonly onSourceSelected: (sourceId: string | null) => void
  readonly onSourceUploaded: (source: SourceView) => void
  readonly onToggleIncluded: (sourceId: string, included: boolean) => void
}

export function WorkspaceShellLayout(
  props: WorkspaceShellLayoutProps,
): ReactElement {
  const { onDesktopLayoutElementChange } = props
  const handleDesktopLayoutRef = useCallback(
    (element: HTMLDivElement | null): void => {
      onDesktopLayoutElementChange(element)
    },
    [onDesktopLayoutElementChange],
  )

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <TopNav
        dashboardUrl={props.dashboardUrl}
        userInitials={props.user ? initialsOf(props.user) : undefined}
        userName={
          props.user ? (props.user.name ?? props.user.email ?? undefined) : undefined
        }
      />

      <div
        data-testid="desktop-panel-layout"
        ref={handleDesktopLayoutRef}
        className="relative hidden flex-1 overflow-x-auto overflow-y-hidden min-[1116px]:block"
      >
        <div
          data-testid="desktop-resizable-panels"
          className="flex h-full"
          style={{
            minWidth: `${props.minimumDesktopPanelWidth}px`,
            width: "100%",
          }}
        >
          <div
            data-testid="desktop-sources-panel"
            ref={(element) => {
              props.onDesktopPanelElementChange("sources", element)
            }}
            className="h-full shrink-0"
            style={{
              minWidth: `${workspaceShellState.minimumDesktopPanelWidths.sources}px`,
              width: `${props.desktopPanelWidths.sources}px`,
            }}
          >
            <SourcesPanel
              sources={[...props.sources]}
              onSourceUploaded={
                props.isGuest ? undefined : props.onSourceUploaded
              }
              selectedSourceId={props.selectedSourceId}
              onSelectSource={props.onSourceSelected}
              onToggleIncluded={
                props.isGuest ? undefined : props.onToggleIncluded
              }
              onArchiveSource={props.isGuest ? undefined : props.onArchiveSource}
              archivingSourceIds={[...props.archivingSourceIds]}
              onLoginClick={props.isGuest ? props.onLoginClick : undefined}
            />
          </div>
          <DesktopResizeHandle
            label="Resize sources and parsed chunks"
            onResizeStart={() =>
              props.onDesktopPanelResizeStart("sources", "chunks")
            }
            onResize={(deltaX) =>
              props.onDesktopPanelResize("sources", "chunks", deltaX)
            }
            onResizeEnd={props.onDesktopPanelResizeEnd}
          />
          <div
            data-testid="desktop-chunks-panel"
            ref={(element) => {
              props.onDesktopPanelElementChange("chunks", element)
            }}
            className="h-full min-w-0 shrink-0 grow"
            style={{
              minWidth: `${workspaceShellState.minimumDesktopPanelWidths.chunks}px`,
              width: `${props.desktopPanelWidths.chunks}px`,
            }}
          >
            <ChunksPanel
              chunks={[...props.selectedChunks]}
              selectedSource={props.selectedSourceTitle}
              selectedSourceFile={props.selectedSourceFile}
              focusedChunkId={props.focusedChunk.chunkId}
              focusedChunkRequestId={props.focusedChunk.requestId}
              isLoading={props.isSelectedChunksLoading}
              isLoadingMore={props.isSelectedChunksLoadingMore}
              hasMoreChunks={props.hasMoreSelectedChunks}
              onLoadMore={props.onLoadMoreChunks}
              onLoginClick={props.isGuest ? props.onLoginClick : undefined}
              onSourceUploaded={
                props.isGuest ? undefined : props.onSourceUploaded
              }
            />
          </div>
          <DesktopResizeHandle
            label="Resize parsed chunks and chat"
            onResizeStart={() =>
              props.onDesktopPanelResizeStart("chunks", "chat")
            }
            onResize={(deltaX) =>
              props.onDesktopPanelResize("chunks", "chat", deltaX)
            }
            onResizeEnd={props.onDesktopPanelResizeEnd}
          />
          <div
            data-testid="desktop-chat-panel"
            ref={(element) => {
              props.onDesktopPanelElementChange("chat", element)
            }}
            className="h-full shrink-0"
            style={{
              minWidth: `${workspaceShellState.minimumDesktopPanelWidths.chat}px`,
              width: `${props.desktopPanelWidths.chat}px`,
            }}
          >
            <ChatPanel
              messages={props.chat.messages}
              threads={[...props.chatThreads]}
              activeThreadId={props.chat.threadId}
              isDisabled={props.isGuest || props.readySourceCount === 0}
              isSending={props.chat.isSending}
              isHistoryLoading={props.chat.isLoading}
              isCreatingThread={props.isCreatingThread}
              loadingThreadId={props.loadingThreadId}
              archivingThreadIds={[...props.archivingThreadIds]}
              pendingCitationId={props.pendingCitationId}
              pendingStatusText={props.chat.pendingStatusText}
              sourceCount={props.readySourceCount}
              onSend={props.onChatSend}
              onNewChat={props.isGuest ? undefined : props.onCreateChatThread}
              onThreadSelect={
                props.isGuest ? undefined : props.onSelectChatThread
              }
              onThreadArchive={
                props.isGuest ? undefined : props.onArchiveChatThread
              }
              onCitationClick={props.onCitationClick}
              onLoginClick={props.isGuest ? props.onLoginClick : undefined}
              sourceTitlesByDocumentId={props.sourceTitlesByDocumentId}
            />
          </div>
        </div>
      </div>

      <div
        id="panel-sources"
        role="tabpanel"
        aria-labelledby="tab-sources"
        className={`min-[1116px]:hidden flex-1 overflow-hidden pb-14 ${
          props.mobilePanel === "sources" ? "flex flex-col" : "hidden"
        }`}
      >
        <SourcesPanel
          sources={[...props.sources]}
          onSourceUploaded={props.isGuest ? undefined : props.onSourceUploaded}
          selectedSourceId={props.selectedSourceId}
          onSelectSource={(id) => {
            props.onSourceSelected(id)
            if (id) props.onMobilePanelChange("content")
          }}
          onToggleIncluded={props.isGuest ? undefined : props.onToggleIncluded}
          onArchiveSource={props.isGuest ? undefined : props.onArchiveSource}
          archivingSourceIds={[...props.archivingSourceIds]}
          onLoginClick={props.isGuest ? props.onLoginClick : undefined}
        />
      </div>
      <div
        id="panel-content"
        role="tabpanel"
        aria-labelledby="tab-content"
        className={`min-[1116px]:hidden flex-1 overflow-hidden pb-14 ${
          props.mobilePanel === "content" ? "flex flex-col" : "hidden"
        }`}
      >
        <ChunksPanel
          chunks={[...props.selectedChunks]}
          selectedSource={props.selectedSourceTitle}
          selectedSourceFile={props.selectedSourceFile}
          focusedChunkId={props.focusedChunk.chunkId}
          focusedChunkRequestId={props.focusedChunk.requestId}
          isLoading={props.isSelectedChunksLoading}
          isLoadingMore={props.isSelectedChunksLoadingMore}
          hasMoreChunks={props.hasMoreSelectedChunks}
          onLoadMore={props.onLoadMoreChunks}
          onLoginClick={props.isGuest ? props.onLoginClick : undefined}
          onSourceUploaded={props.isGuest ? undefined : props.onSourceUploaded}
        />
      </div>
      <div
        id="panel-chat"
        role="tabpanel"
        aria-labelledby="tab-chat"
        className={`min-[1116px]:hidden flex-1 overflow-hidden pb-14 ${
          props.mobilePanel === "chat" ? "flex flex-col" : "hidden"
        }`}
      >
        <ChatPanel
          messages={props.chat.messages}
          threads={[...props.chatThreads]}
          activeThreadId={props.chat.threadId}
          isDisabled={props.isGuest || props.readySourceCount === 0}
          isSending={props.chat.isSending}
          isHistoryLoading={props.chat.isLoading}
          isCreatingThread={props.isCreatingThread}
          loadingThreadId={props.loadingThreadId}
          archivingThreadIds={[...props.archivingThreadIds]}
          pendingCitationId={props.pendingCitationId}
          pendingStatusText={props.chat.pendingStatusText}
          sourceCount={props.readySourceCount}
          onSend={props.onChatSend}
          onNewChat={props.isGuest ? undefined : props.onCreateChatThread}
          onThreadSelect={props.isGuest ? undefined : props.onSelectChatThread}
          onThreadArchive={props.isGuest ? undefined : props.onArchiveChatThread}
          onLoginClick={props.isGuest ? props.onLoginClick : undefined}
          sourceTitlesByDocumentId={props.sourceTitlesByDocumentId}
          onCitationClick={(citation, citationId) => {
            props.onMobilePanelChange("content")
            props.onCitationClick(citation, citationId)
          }}
        />
      </div>

      <MobileTabBar
        activePanel={props.mobilePanel}
        onPanelChange={props.onMobilePanelChange}
        sourceCount={props.readySourceCount}
        chunkCount={props.selectedChunks.length}
        hasMessages={props.hasMessages}
      />

      {props.chat.error && (
        <div className="fixed bottom-18 right-4 z-50 max-w-sm rounded-lg border border-destructive/30 bg-background px-4 py-3 text-sm text-destructive shadow-lg min-[1116px]:bottom-4">
          {props.chat.error}
        </div>
      )}
    </div>
  )
}

function initialsOf(user: WorkspaceShellUser): string {
  const source = user.name ?? user.email ?? user.id
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0][0]!.toUpperCase()
  return (parts[0][0]! + parts[1][0]!).toUpperCase()
}

function DesktopResizeHandle({
  label,
  onResize,
  onResizeEnd,
  onResizeStart,
}: {
  readonly label: string
  readonly onResize: (deltaX: number) => void
  readonly onResizeEnd?: () => void
  readonly onResizeStart?: () => void
}): ReactElement {
  const { handlePointerDown } = useWorkspaceResizeHandleWorkflow({
    onResize,
    onResizeEnd,
    onResizeStart,
  })

  return (
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      className="group flex h-full shrink-0 cursor-col-resize items-center justify-center border-x border-transparent bg-border/40 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      style={{ width: `${workspaceShellState.desktopPanelGutterWidth}px` }}
      onPointerDown={handlePointerDown}
    >
      <span className="h-10 w-0.5 rounded-full bg-muted-foreground/35 group-hover:bg-primary/60" />
    </button>
  )
}
