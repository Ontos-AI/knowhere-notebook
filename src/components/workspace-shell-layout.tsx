import { useCallback, type ReactElement } from "react"
import {
  Database,
  FileText,
  MessageSquare,
  PanelLeftOpen,
  PanelRightOpen,
} from "lucide-react"

import { ChatPanel } from "@/components/chat-panel"
import { ChunksPanel } from "@/components/chunks-panel"
import { MobileTabBar } from "@/components/mobile-tab-bar"
import { OfficialLibraryPanel } from "@/components/official-library-panel"
import { SourcesPanel } from "@/components/sources-panel"
import { TopNav } from "@/components/top-nav"
import type { AnalyticsContext } from "@/lib/posthog"
import { useWorkspaceResizeHandleWorkflow } from "@/components/workspace-resize-handle-workflow"
import { workspaceShellState } from "@/components/workspace-shell-state"
import type {
  ChatCitationView,
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type {
  OfficialLibrarySourceView,
  SourceOriginalFileView,
  SourceView,
} from "@/domains/sources/types"

export type PanelId = "sources" | "chat"
export type ContentView = "chunks" | "library"

type DesktopPanelKey = keyof typeof workspaceShellState.minimumDesktopPanelWidths
type DesktopSidePanelKey = Exclude<DesktopPanelKey, "chunks">
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
  readonly addingLibrarySourceIds: readonly string[]
  readonly archivingSourceIds: readonly string[]
  readonly retryingSourceIds?: readonly string[]
  readonly archivingThreadIds: readonly string[]
  readonly chat: WorkspaceChatState
  readonly chatThreads: readonly ChatThreadView[]
  readonly citationListViewRequestId: number
  readonly dashboardUrl?: string
  readonly desktopPanelWidths: Readonly<DesktopPanelWidths>
  readonly focusedChunk: FocusedChunkState
  readonly hasMessages: boolean
  readonly hasMoreSelectedChunks: boolean
  readonly contentView: ContentView
  readonly isChunksOverlayVisible: boolean
  readonly isCreatingThread: boolean
  readonly isGuest: boolean
  readonly isSelectedAllChunksLoading: boolean
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
  readonly officialLibrarySources: readonly OfficialLibrarySourceView[]
  readonly user: WorkspaceShellUser | undefined
  readonly analyticsContext?: AnalyticsContext
  readonly onArchiveChatThread: (threadId: string) => void | Promise<void>
  readonly onArchiveSource: (sourceId: string) => void | Promise<void>
  readonly onRetrySource?: (sourceId: string) => void | Promise<void>
  readonly onChatSend: (text: string) => void | Promise<void>
  readonly onCitationClick: (
    citation: ChatCitationView,
    citationId: string,
  ) => void | Promise<void>
  readonly onCloseChunksOverlay: () => void
  readonly onCreateChatThread: () => void | Promise<void>
  readonly onDesktopLayoutElementChange: (element: HTMLDivElement | null) => void
  readonly onDesktopPanelElementChange: (
    panel: DesktopPanelKey,
    element: HTMLDivElement | null,
  ) => void
  readonly onDesktopPanelExpand: (panel: DesktopSidePanelKey) => void
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
  readonly onLoadAllChunks: () => void
  readonly onLoadMoreChunks: () => void
  readonly onLoginClick: () => void
  readonly onLibraryBack: () => void
  readonly onLibraryOpen: () => void
  readonly onMobilePanelChange: (panel: PanelId) => void
  readonly onOpenChunksOverlay: (sourceId?: string) => void
  readonly onOfficialLibrarySourceAdd: (
    demoSourceId: string,
  ) => void | Promise<void>
  readonly onSelectChatThread: (threadId: string) => void
  readonly onSourceSelected: (sourceId: string | null) => void
  readonly onSourceUploaded: (source: SourceView) => void
  readonly onToggleIncluded: (sourceId: string, included: boolean) => void
}

export function WorkspaceShellLayout(
  props: WorkspaceShellLayoutProps,
): ReactElement {
  const { onDesktopLayoutElementChange } = props
  const addingLibrarySourceIds = props.addingLibrarySourceIds ?? []
  const retryingSourceIds = props.retryingSourceIds ?? []
  const officialLibrarySources = props.officialLibrarySources ?? []
  const selectedSourcesCount = props.sources.filter(
    (source) => !source.excludedFromQuery && source.status === "ready",
  ).length
  const isSourcesPanelCollapsed =
    props.desktopPanelWidths.sources <=
    workspaceShellState.desktopSidePanelCompactThreshold
  const isChatPanelCollapsed =
    props.desktopPanelWidths.chat <=
    workspaceShellState.desktopSidePanelCompactThreshold
  const isSourcesPanelNarrow = props.desktopPanelWidths.sources < 220
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
        analyticsContext={props.analyticsContext}
        hasChats={props.chatThreads.length > 0}
        hasSources={props.readySourceCount > 0}
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
              minWidth: `${workspaceShellState.collapsedDesktopPanelWidth}px`,
              width: `${props.desktopPanelWidths.sources}px`,
            }}
          >
            {isSourcesPanelCollapsed ? (
              <CompactSourcesSidebar
                sources={props.sources}
                selectedSourceId={props.selectedSourceId}
                onExpand={() => props.onDesktopPanelExpand("sources")}
                onSourceSelected={props.onSourceSelected}
              />
            ) : (
              <SourcesPanel
                sources={[...props.sources]}
                officialLibrarySources={[...officialLibrarySources]}
                isLibraryOpen={props.contentView === "library"}
                isNarrow={isSourcesPanelNarrow}
                analyticsContext={props.analyticsContext}
                sourceCountSnapshot={props.sources.length}
                onSourceUploaded={
                  props.isGuest ? undefined : props.onSourceUploaded
                }
                selectedSourceId={props.selectedSourceId}
                onSelectSource={props.onSourceSelected}
                onToggleIncluded={
                  props.isGuest ? undefined : props.onToggleIncluded
                }
                onArchiveSource={
                  props.isGuest ? undefined : props.onArchiveSource
                }
                onRetrySource={
                  props.isGuest ? undefined : props.onRetrySource
                }
                onOfficialLibrarySourceAdd={
                  props.isGuest ? undefined : props.onOfficialLibrarySourceAdd
                }
                onLibraryOpen={props.onLibraryOpen}
                onOpenChunksOverlay={props.onOpenChunksOverlay}
                archivingSourceIds={[...props.archivingSourceIds]}
                retryingSourceIds={[...retryingSourceIds]}
                addingLibrarySourceIds={[...addingLibrarySourceIds]}
                onLoginClick={props.isGuest ? props.onLoginClick : undefined}
              />
            )}
          </div>
          <DesktopResizeHandle
            label="Resize sources and chat"
            onResizeStart={() =>
              props.onDesktopPanelResizeStart("sources", "chat")
            }
            onResize={(deltaX) =>
              props.onDesktopPanelResize("sources", "chat", deltaX)
            }
            onResizeEnd={props.onDesktopPanelResizeEnd}
          />
          <div
            data-testid="desktop-chat-panel"
            ref={(element) => {
              props.onDesktopPanelElementChange("chat", element)
            }}
            className="h-full min-w-0 shrink-0 grow"
            style={{
              minWidth: `${workspaceShellState.collapsedDesktopPanelWidth}px`,
              width: `${props.desktopPanelWidths.chat}px`,
            }}
          >
            {isChatPanelCollapsed ? (
              <CompactChatSidebar
                activeThreadId={props.chat.threadId}
                threads={props.chatThreads}
                onExpand={() => props.onDesktopPanelExpand("chat")}
                onThreadSelected={(threadId) => {
                  props.onSelectChatThread(threadId)
                  props.onDesktopPanelExpand("chat")
                }}
              />
            ) : (
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
                analyticsContext={props.analyticsContext}
                selectedSourcesCount={selectedSourcesCount}
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
            )}
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
          analyticsContext={props.analyticsContext}
          sourceCountSnapshot={props.sources.length}
          officialLibrarySources={[...officialLibrarySources]}
          isLibraryOpen={props.contentView === "library"}
          onSourceUploaded={props.isGuest ? undefined : props.onSourceUploaded}
          selectedSourceId={props.selectedSourceId}
          onSelectSource={props.onSourceSelected}
          onToggleIncluded={props.isGuest ? undefined : props.onToggleIncluded}
          onArchiveSource={props.isGuest ? undefined : props.onArchiveSource}
          onRetrySource={props.isGuest ? undefined : props.onRetrySource}
          onOfficialLibrarySourceAdd={
            props.isGuest ? undefined : props.onOfficialLibrarySourceAdd
          }
          onLibraryOpen={props.onLibraryOpen}
          onOpenChunksOverlay={props.onOpenChunksOverlay}
          archivingSourceIds={[...props.archivingSourceIds]}
          retryingSourceIds={[...retryingSourceIds]}
          addingLibrarySourceIds={[...addingLibrarySourceIds]}
          onLoginClick={props.isGuest ? props.onLoginClick : undefined}
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
          analyticsContext={props.analyticsContext}
          selectedSourcesCount={selectedSourcesCount}
          onSend={props.onChatSend}
          onNewChat={props.isGuest ? undefined : props.onCreateChatThread}
          onThreadSelect={props.isGuest ? undefined : props.onSelectChatThread}
          onThreadArchive={props.isGuest ? undefined : props.onArchiveChatThread}
          onLoginClick={props.isGuest ? props.onLoginClick : undefined}
          sourceTitlesByDocumentId={props.sourceTitlesByDocumentId}
          onCitationClick={props.onCitationClick}
        />
      </div>

      <MobileTabBar
        activePanel={props.mobilePanel}
        onPanelChange={props.onMobilePanelChange}
        sourceCount={props.readySourceCount}
        chunkCount={props.selectedChunks.length}
        hasMessages={props.hasMessages}
      />

      {props.isChunksOverlayVisible ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <ChunksPanel
            chunks={[...props.selectedChunks]}
            selectedSource={props.selectedSourceTitle}
            selectedSourceFile={props.selectedSourceFile}
            citationListViewRequestId={props.citationListViewRequestId}
            focusedChunkId={props.focusedChunk.chunkId}
            focusedChunkRequestId={props.focusedChunk.requestId}
            isLoading={props.isSelectedChunksLoading}
            isLoadingAllChunks={props.isSelectedAllChunksLoading}
            isLoadingMore={props.isSelectedChunksLoadingMore}
            hasMoreChunks={props.hasMoreSelectedChunks}
            onLoadAllChunks={props.onLoadAllChunks}
            onLoadMore={props.onLoadMoreChunks}
            onClose={props.onCloseChunksOverlay}
            onLoginClick={props.isGuest ? props.onLoginClick : undefined}
            onSourceUploaded={
              props.isGuest ? undefined : props.onSourceUploaded
            }
            analyticsContext={props.analyticsContext}
            sourceCountSnapshot={props.sources.length}
          />
        </div>
      ) : null}

      {props.contentView === "library" ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <OfficialLibraryPanel
            addingLibrarySourceIds={[...addingLibrarySourceIds]}
            officialLibrarySources={[...officialLibrarySources]}
            sources={[...props.sources]}
            onBack={props.onLibraryBack}
            onOfficialLibrarySourceAdd={
              props.isGuest ? undefined : props.onOfficialLibrarySourceAdd
            }
          />
        </div>
      ) : null}

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

function DesktopPanelRestoreButton({
  label,
  onClick,
  side,
}: {
  readonly label: string
  readonly onClick: () => void
  readonly side: "left" | "right"
}): ReactElement {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-10 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      onClick={onClick}
    >
      <Icon className="size-4" strokeWidth={1.8} />
    </button>
  )
}

function CompactSourcesSidebar({
  onExpand,
  onSourceSelected,
  selectedSourceId,
  sources,
}: {
  readonly onExpand: () => void
  readonly onSourceSelected: (sourceId: string | null) => void
  readonly selectedSourceId: string | null
  readonly sources: readonly SourceView[]
}): ReactElement {
  return (
    <aside className="flex h-full w-full flex-col items-center border-r border-border/70 bg-background px-2 py-3">
      <DesktopPanelRestoreButton
        label="Show sources panel"
        side="left"
        onClick={onExpand}
      />
      <div className="my-3 h-px w-9 bg-border" />
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
        {sources.length === 0 ? (
          <span
            aria-label="No sources"
            className="inline-flex size-11 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground"
            role="img"
          >
            <Database className="size-4" strokeWidth={1.8} />
          </span>
        ) : (
          sources.map((source) => (
            <CompactSidebarButton
              key={source.id}
              ariaLabel={`Open source ${source.title}`}
              isActive={source.id === selectedSourceId}
              label={getCompactItemLabel(source.title)}
              title={source.title}
              onClick={() => onSourceSelected(source.id)}
            >
              <FileText className="size-4" strokeWidth={1.8} />
            </CompactSidebarButton>
          ))
        )}
      </div>
    </aside>
  )
}

function CompactChatSidebar({
  activeThreadId,
  onExpand,
  onThreadSelected,
  threads,
}: {
  readonly activeThreadId: string | null
  readonly onExpand: () => void
  readonly onThreadSelected: (threadId: string) => void
  readonly threads: readonly ChatThreadView[]
}): ReactElement {
  return (
    <aside className="flex h-full w-full flex-col items-center border-l border-border/70 bg-muted/40 px-2 py-3">
      <DesktopPanelRestoreButton
        label="Show chat panel"
        side="right"
        onClick={onExpand}
      />
      <div className="my-3 h-px w-9 bg-border" />
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
        {threads.length === 0 ? (
          <span
            aria-label="No chats"
            className="inline-flex size-11 items-center justify-center rounded-lg border border-border bg-background/70 text-muted-foreground"
            role="img"
          >
            <MessageSquare className="size-4" strokeWidth={1.8} />
          </span>
        ) : (
          threads.map((thread) => (
            <CompactSidebarButton
              key={thread.id}
              ariaLabel={`Open chat ${thread.title}`}
              isActive={thread.id === activeThreadId}
              label={getCompactItemLabel(thread.title)}
              title={thread.title}
              onClick={() => onThreadSelected(thread.id)}
            >
              <MessageSquare className="size-4" strokeWidth={1.8} />
            </CompactSidebarButton>
          ))
        )}
      </div>
    </aside>
  )
}

function CompactSidebarButton({
  ariaLabel,
  children,
  isActive,
  label,
  onClick,
  title,
}: {
  readonly ariaLabel: string
  readonly children: ReactElement
  readonly isActive: boolean
  readonly label: string
  readonly onClick: () => void
  readonly title: string
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      className={`flex h-[52px] w-[52px] flex-col items-center justify-center gap-1 rounded-lg border text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
        isActive
          ? "border-primary/60 bg-primary/10 text-foreground"
          : "border-border bg-background"
      }`}
      onClick={onClick}
    >
      {children}
      <span className="max-w-10 truncate text-[10px] font-semibold leading-none">
        {label}
      </span>
    </button>
  )
}

function getCompactItemLabel(title: string): string {
  const normalizedTitle = title.trim()
  if (!normalizedTitle) return "?"

  const words = normalizedTitle
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[\s._-]+/)
    .filter(Boolean)

  if (words.length >= 2) {
    return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase()
  }

  return normalizedTitle.slice(0, 2).toUpperCase()
}
