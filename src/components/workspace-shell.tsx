"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import useSWR, { SWRConfig, unstable_serialize, useSWRConfig } from "swr"
import type { Cache } from "swr"
import useSWRInfinite from "swr/infinite"
import useSWRMutation from "swr/mutation"
import { TopNav } from "@/components/top-nav"
import { SourcesPanel } from "@/components/sources-panel"
import { ChunksPanel } from "@/components/chunks-panel"
import { ChatPanel } from "@/components/chat-panel"
import { MobileTabBar } from "@/components/mobile-tab-bar"
import { deriveChatThreadTitle } from "@/lib/chat-title"
import { workspaceClient } from "@/lib/workspace-client"
import {
  resolveChunkConnectionTargets,
  resolveCitationChunk,
  resolveCitationChunkByContent,
} from "@/lib/chunks"
import { useHashFragment } from "@/lib/use-hash-fragment"
import type {
  ChatCitationView,
  ChatMessageView,
  ChatThreadView,
  ParsedChunkView,
  SourceView,
} from "@/lib/types"

export type PanelId = "sources" | "content" | "chat"

export const DESKTOP_PANEL_GUTTER_WIDTH = 8
export const DESKTOP_PANEL_MIN_WIDTHS = {
  sources: 260,
  chunks: 480,
  chat: 360,
} as const

const DESKTOP_PANEL_DEFAULT_WIDTHS = {
  sources: 350,
  chunks: 720,
  chat: 420,
} as const

const sourcesSWRKey = workspaceClient.keys.sources
const chatThreadsSWRKey = workspaceClient.keys.chatThreads
const chatSWRKey = workspaceClient.keys.chat
const archiveSourceSWRKey = workspaceClient.keys.archiveSource
const archiveChatThreadSWRKey = workspaceClient.keys.archiveChatThread

type DesktopPanelKey = keyof typeof DESKTOP_PANEL_MIN_WIDTHS
type DesktopPanelWidths = Record<DesktopPanelKey, number>

type DesktopPanelResizeDrag = {
  leftPanel: DesktopPanelKey
  rightPanel: DesktopPanelKey
  leftWidth: number
  rightWidth: number
}

type FocusedChunkState = {
  chunkId: string | null
  requestId: number
}

type ChatState = {
  threadId: string | null
  messages: ChatMessageView[]
  isSending: boolean
  isLoading: boolean
  error: string | null
}

type SourceChunksKey = readonly ["source-chunks", string, number]
type ChatThreadKey = readonly ["chat-thread", string]
type SourceChunksResponse = Awaited<
  ReturnType<typeof workspaceClient.fetchChunkPage>
>
type ChatThreadDetailResponse = Awaited<
  ReturnType<typeof workspaceClient.fetchChatThread>
>
type ChatMessageRequest = Parameters<typeof workspaceClient.sendChatMessage>[0]

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
  isGuest?: boolean
  loginUrl?: string
}

export function WorkspaceShell(props: WorkspaceShellProps) {
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
  isGuest = false,
  loginUrl,
}: WorkspaceShellProps) {
  const initialSrcs = initialSources ?? []
  const initialSelectedSourceId = isGuest
    ? (initialSrcs.find((source) => source.status === "ready")?.id ?? null)
    : null

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    initialSelectedSourceId,
  )
  const [focusedChunk, setFocusedChunk] = useState<FocusedChunkState>({
    chunkId: null,
    requestId: 0,
  })
  const [sourceExclusionById, setSourceExclusionById] = useState<
    Record<string, boolean>
  >({})
  const [archivingSourceIds, setArchivingSourceIds] = useState<string[]>([])
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null)
  const [archivingThreadIds, setArchivingThreadIds] = useState<string[]>([])
  const [pendingCitationId, setPendingCitationId] = useState<string | null>(
    null,
  )
  const [prefetchedChunksBySourceId, setPrefetchedChunksBySourceId] = useState<
    Record<string, ParsedChunkView[]>
  >({})
  const [mobilePanel, setMobilePanel] = useState<PanelId>(
    isGuest ? "content" : "chat",
  )
  const [chat, setChat] = useState<ChatState>({
    threadId: activeChatThreadId ?? null,
    messages: initialChatMessages ?? [],
    isSending: false,
    isLoading: false,
    error: null,
  })
  const optimisticMessageSequence = useRef(0)
  const { cache, mutate: mutateSWR } = useSWRConfig()
  const { data: serverSources, mutate: mutateSources } = useSWR(
    sourcesSWRKey,
    workspaceClient.fetchSources,
    {
      fallbackData: initialSrcs,
      revalidateIfStale: false,
      revalidateOnMount: false,
      refreshInterval: (currentSources) =>
        hasPendingSources(currentSources ?? []) ? 3000 : 0,
    },
  )
  const sourceRows = serverSources ?? initialSrcs
  const sources = applySourceQueryState(sourceRows, sourceExclusionById)
  const sourceTitlesByDocumentId = useMemo<Readonly<Record<string, string>>>(
    () =>
      Object.fromEntries(
        sources.flatMap((source): readonly [string, string][] =>
          source.documentId ? [[source.documentId, source.title]] : [],
        ),
      ),
    [sources],
  )
  const { data: serverChatThreads, mutate: mutateChatThreads } = useSWR(
    isGuest ? null : chatThreadsSWRKey,
    workspaceClient.fetchChatThreads,
    {
      fallbackData: initialChatThreads ?? [],
      revalidateIfStale: false,
      revalidateOnMount: false,
    },
  )
  const chatThreads = serverChatThreads ?? initialChatThreads ?? []
  const selectedSource = sources.find((source) => source.id === selectedSourceId)
  const prefetchedSelectedChunks = selectedSourceId
    ? prefetchedChunksBySourceId[selectedSourceId]
    : undefined
  const selectedChunkSourceId =
    selectedSource && selectedSource.status === "ready" && !prefetchedSelectedChunks
      ? selectedSource.id
      : null
  const {
    data: selectedChunkPages,
    isLoading: isChunksLoading,
    size: selectedChunkPageCount,
    setSize: setSelectedChunkPageCount,
  } = useSWRInfinite<SourceChunksResponse, Error>(
    (pageIndex: number, previousPageData: SourceChunksResponse | null) =>
      getSourceChunksKey(selectedChunkSourceId, pageIndex, previousPageData),
    fetchChunksByKey,
    {
      revalidateIfStale: false,
      keepPreviousData: false,
    },
  )
  const pagedSelectedChunks = useMemo(
    () =>
      resolveChunkConnectionTargets(
        (selectedChunkPages ?? []).flatMap((page) => page.chunks ?? []),
      ),
    [selectedChunkPages],
  )
  const selectedChunks = selectedSourceId
    ? (prefetchedSelectedChunks ?? pagedSelectedChunks)
    : []
  const hasMoreSelectedChunks =
    !prefetchedSelectedChunks && hasMoreChunkPages(selectedChunkPages)
  const isSelectedChunksLoadingMore =
    !prefetchedSelectedChunks &&
    Boolean(
      selectedChunkPageCount > 0 &&
        selectedChunkPages &&
        typeof selectedChunkPages[selectedChunkPageCount - 1] === "undefined",
    )
  const isSelectedChunksLoading =
    selectedChunkSourceId !== null &&
    !prefetchedSelectedChunks &&
    !selectedChunkPages &&
    isChunksLoading
  const initialChatThreadData = useMemo(
    () =>
      getInitialChatThreadData(
        activeChatThreadId ?? null,
        initialChatThreads ?? [],
        initialChatMessages ?? [],
      ),
    [activeChatThreadId, initialChatMessages, initialChatThreads],
  )
  const activeChatThreadKey = chat.threadId
    ? getChatThreadKey(chat.threadId)
    : null
  useSWR(
    activeChatThreadKey,
    fetchChatThreadByKey,
    {
      fallbackData:
        chat.threadId === activeChatThreadId
          ? initialChatThreadData
          : undefined,
      revalidateIfStale: false,
      revalidateOnMount: false,
      onSuccess: handleChatThreadLoaded,
      onError: handleChatThreadLoadFailed,
    },
  )
  const { trigger: createChatThread, isMutating: isCreatingThread } =
    useSWRMutation(chatThreadsSWRKey, createChatThreadMutation)
  const { trigger: sendChatMessage } = useSWRMutation(
    chatSWRKey,
    sendChatMessageMutation,
  )
  const { trigger: archiveSource } = useSWRMutation(
    archiveSourceSWRKey,
    archiveSourceMutation,
  )
  const { trigger: archiveChatThread } = useSWRMutation(
    archiveChatThreadSWRKey,
    archiveChatThreadMutation,
  )
  const [desktopPanelWidths, setDesktopPanelWidths] =
    useState<DesktopPanelWidths>({ ...DESKTOP_PANEL_DEFAULT_WIDTHS })
  const desktopPanelElements = useRef<Record<DesktopPanelKey, HTMLDivElement | null>>({
    sources: null,
    chunks: null,
    chat: null,
  })
  const desktopPanelResizeDrag = useRef<DesktopPanelResizeDrag | null>(null)

  const minimumDesktopPanelWidth =
    DESKTOP_PANEL_MIN_WIDTHS.sources +
    DESKTOP_PANEL_MIN_WIDTHS.chunks +
    DESKTOP_PANEL_MIN_WIDTHS.chat +
    DESKTOP_PANEL_GUTTER_WIDTH * 2

  function redirectToLogin() {
    window.location.href = loginUrl ?? "/login"
  }

  const [hashChunkId, setHashChunkId] = useHashFragment()

  const requestChunkFocus = useCallback(
    (chunkId: string | null): void => {
      setFocusedChunk((current) => ({
        chunkId,
        requestId: current.requestId + 1,
      }))
      // Push to URL hash so back/forward and deep-linking work.
      setHashChunkId(chunkId)
    },
    [setHashChunkId],
  )

  // Read the initial hash fragment and trigger focus if present.
  useEffect(() => {
    if (!hashChunkId) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      requestChunkFocus(hashChunkId)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [hashChunkId, requestChunkFocus])

  function handleLoadMoreChunks(): void {
    if (!hasMoreSelectedChunks || isSelectedChunksLoadingMore) return
    void setSelectedChunkPageCount(selectedChunkPageCount + 1)
  }

  function handleDesktopPanelResize(
    leftPanel: DesktopPanelKey,
    rightPanel: DesktopPanelKey,
    deltaX: number,
  ): void {
    setDesktopPanelWidths((current) => {
      const drag = desktopPanelResizeDrag.current
      const leftCurrentWidth =
        drag?.leftPanel === leftPanel && drag.rightPanel === rightPanel
          ? drag.leftWidth
          : getRenderedDesktopPanelWidth(leftPanel, current[leftPanel])
      const rightCurrentWidth =
        drag?.leftPanel === leftPanel && drag.rightPanel === rightPanel
          ? drag.rightWidth
          : getRenderedDesktopPanelWidth(rightPanel, current[rightPanel])
      const totalWidth = leftCurrentWidth + rightCurrentWidth
      const leftMinimumWidth = DESKTOP_PANEL_MIN_WIDTHS[leftPanel]
      const rightMinimumWidth = DESKTOP_PANEL_MIN_WIDTHS[rightPanel]
      const leftWidth = clamp(
        leftCurrentWidth + deltaX,
        leftMinimumWidth,
        totalWidth - rightMinimumWidth,
      )

      return {
        ...current,
        [leftPanel]: leftWidth,
        [rightPanel]: totalWidth - leftWidth,
      }
    })
  }

  function handleDesktopPanelResizeStart(
    leftPanel: DesktopPanelKey,
    rightPanel: DesktopPanelKey,
  ): void {
    desktopPanelResizeDrag.current = {
      leftPanel,
      rightPanel,
      leftWidth: getRenderedDesktopPanelWidth(
        leftPanel,
        desktopPanelWidths[leftPanel],
      ),
      rightWidth: getRenderedDesktopPanelWidth(
        rightPanel,
        desktopPanelWidths[rightPanel],
      ),
    }
  }

  function handleDesktopPanelResizeEnd(): void {
    desktopPanelResizeDrag.current = null
  }

  function getRenderedDesktopPanelWidth(
    panel: DesktopPanelKey,
    fallbackWidth: number,
  ): number {
    const renderedWidth =
      desktopPanelElements.current[panel]?.getBoundingClientRect().width

    return renderedWidth && Number.isFinite(renderedWidth) && renderedWidth > 0
      ? renderedWidth
      : fallbackWidth
  }

  const selectedSourceTitle = selectedSource?.title ?? null

  function handleChatThreadLoaded(body: ChatThreadDetailResponse): void {
    const requestedThreadId = body.requestedThreadId

    if (!body.thread || !Array.isArray(body.messages)) {
      setChat((current) =>
        current.threadId === requestedThreadId
          ? {
              ...current,
              isLoading: false,
              error: body.message ?? "The chat could not be loaded right now.",
            }
          : current,
      )
      setLoadingThreadId((current) =>
        current === requestedThreadId ? null : current,
      )
      return
    }

    setChat((current) =>
      current.threadId === requestedThreadId
        ? {
            ...current,
            messages: body.messages!,
            isLoading: false,
            error: null,
          }
        : current,
    )
    setLoadingThreadId((current) =>
      current === requestedThreadId ? null : current,
    )
  }

  function handleChatThreadLoadFailed(): void {
    setChat((current) => ({
      ...current,
      isLoading: false,
      error: "The chat could not be loaded right now.",
    }))
    setLoadingThreadId(null)
  }

  function handleSourceUploaded(source: SourceView) {
    void mutateSources(
      (current) => upsertSource(current ?? sourceRows, source),
      { revalidate: false },
    )
    void mutateSources()
  }

  function handleToggleIncluded(sourceId: string, included: boolean) {
    setSourceExclusionById((current) => ({
      ...current,
      [sourceId]: !included,
    }))
  }

  async function handleArchiveSource(sourceId: string) {
    setArchivingSourceIds((current) => addPendingId(current, sourceId))
    try {
      await archiveSource(sourceId)
      void mutateSources(
        (current) =>
          (current ?? sourceRows).filter((source) => source.id !== sourceId),
        { revalidate: false },
      )
      setSelectedSourceId((current) =>
        current === sourceId ? null : current,
      )
      setSourceExclusionById((current) => removeRecordKey(current, sourceId))
    } catch {
      // Silently ignore — the source stays in the list.
    } finally {
      setArchivingSourceIds((current) => removePendingId(current, sourceId))
    }
  }

  async function handleCreateChatThread() {
    if (isCreatingThread) return

    try {
      const body = await createChatThread()

      if (!body.thread || !Array.isArray(body.messages)) {
        setChat((current) => ({
          ...current,
          error: body.message ?? "The chat could not be created right now.",
        }))
        return
      }

      void mutateChatThreads(
        (current = []) => upsertThread(current, body.thread!),
        { revalidate: false },
      )
      void mutateSWR(
        getChatThreadKey(body.thread.id),
        { ...body, requestedThreadId: body.thread.id },
        { revalidate: false },
      )
      setChat({
        threadId: body.thread.id,
        messages: body.messages,
        isSending: false,
        isLoading: false,
        error: null,
      })
    } catch {
      setChat((current) => ({
        ...current,
        error: "The chat could not be created right now.",
      }))
    }
  }

  function handleSelectChatThread(threadId: string) {
    if (threadId === chat.threadId) return

    const cachedThreadData =
      getCachedChatThreadData(cache, threadId) ??
      (threadId === activeChatThreadId ? initialChatThreadData : null)

    if (hasLoadedChatThreadData(cachedThreadData)) {
      void mutateSWR(getChatThreadKey(threadId), cachedThreadData, {
        revalidate: false,
      })
      setLoadingThreadId(null)
      setChat({
        threadId,
        messages: cachedThreadData.messages,
        isSending: false,
        isLoading: false,
        error: null,
      })
      return
    }

    setLoadingThreadId(threadId)
    setChat((current) => ({
      ...current,
      threadId,
      isLoading: true,
      error: null,
    }))
  }

  async function handleArchiveChatThread(threadId: string) {
    setArchivingThreadIds((current) => addPendingId(current, threadId))
    try {
      await archiveChatThread(threadId)
      const remainingThreads = chatThreads.filter(
        (thread) => thread.id !== threadId,
      )
      void mutateChatThreads(remainingThreads, { revalidate: false })

      if (chat.threadId !== threadId) return

      const nextThread = remainingThreads[0] ?? null
      if (!nextThread) {
        setChat({
          threadId: null,
          messages: [],
          isSending: false,
          isLoading: false,
          error: null,
        })
        return
      }

      handleSelectChatThread(nextThread.id)
    } catch {
      setChat((current) => ({
        ...current,
        error: "The chat could not be deleted right now.",
      }))
    } finally {
      setArchivingThreadIds((current) => removePendingId(current, threadId))
    }
  }

  function handleSourceSelected(sourceId: string | null) {
    setSelectedSourceId(sourceId)
    if (sourceId) {
      setPrefetchedChunksBySourceId((current) =>
        removeRecordKey(current, sourceId),
      )
    }
    requestChunkFocus(null)
  }

  async function handleChatSend(text: string) {
    optimisticMessageSequence.current += 1
    const optimisticId = `pending-${optimisticMessageSequence.current}`
    const optimisticUser: ChatMessageView = {
      id: optimisticId,
      role: "user",
      content: text,
    }
    setChat((current) => ({
      ...current,
      isSending: true,
      error: null,
      messages: [...current.messages, optimisticUser],
    }))
    try {
      const body = await sendChatMessage({
        message: text,
        threadId: chat.threadId ?? undefined,
        excludedSourceIds: sources
          .filter((source) => source.excludedFromQuery)
          .map((source) => source.id),
      })

      if (!body.threadId || !Array.isArray(body.messages)) {
        setChat((current) => ({
          ...current,
          isSending: false,
          messages: current.messages.filter((m) => m.id !== optimisticId),
          error: body.message ?? "The assistant could not answer right now.",
        }))
        return
      }

      void mutateChatThreads(
        (current = []) => upsertThreadAfterSend(current, body.threadId!, text),
        { revalidate: false },
      )
      setChat((current) => {
        const assistantMessages = body.messages!.filter(
          (m) => m.role === "assistant",
        )
        return {
          threadId: body.threadId ?? current.threadId,
          messages: [...current.messages, ...assistantMessages],
          isSending: false,
          isLoading: false,
          error: null,
        }
      })
      const nextThread = upsertThreadAfterSend(
        chatThreads,
        body.threadId,
        text,
      )[0]
      if (nextThread) {
        void mutateSWR(
          getChatThreadKey(body.threadId),
          {
            requestedThreadId: body.threadId,
            thread: nextThread,
            messages: body.messages,
          },
          { revalidate: false },
        )
      }
    } catch {
      setChat((current) => ({
        ...current,
        isSending: false,
        isLoading: false,
        messages: current.messages.filter((m) => m.id !== optimisticId),
        error: "The assistant could not answer right now.",
      }))
    }
  }

  async function handleCitationClick(
    citation: ChatCitationView,
    citationId: string,
  ) {
    setPendingCitationId(citationId)

    try {
      const source = sources.find(
        (candidate) => candidate.documentId === citation.source.documentId,
      )
      if (!source) return

      if (selectedSourceId === source.id && selectedChunks.length > 0) {
        const focusedChunk = hasMoreSelectedChunks
          ? resolveCitationChunkByContent(citation, selectedChunks)
          : resolveCitationChunk(citation, selectedChunks)
        if (focusedChunk) {
          requestChunkFocus(focusedChunk.chunkId)
          return
        }
      }

      requestChunkFocus(null)
      const chunks = await fetchChunks(source.id)
      setPrefetchedChunksBySourceId((current) => ({
        ...current,
        [source.id]: chunks,
      }))
      const focusedChunk = resolveCitationChunk(citation, chunks)
      setSelectedSourceId(source.id)
      requestChunkFocus(focusedChunk?.chunkId ?? null)
    } finally {
      setPendingCitationId((current) =>
        current === citationId ? null : current,
      )
    }
  }

  const readySourceCount = sources.filter(
    (source) => source.status === "ready",
  ).length

  const hasMessages = chat.messages.length > 0

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <TopNav
        userInitials={user ? initialsOf(user) : undefined}
        userName={user ? (user.name ?? user.email ?? undefined) : undefined}
      />

      {/* Desktop: resizable three-panel strip with horizontal overflow at minimum widths. */}
      <div
        data-testid="desktop-panel-layout"
        className="relative hidden flex-1 overflow-x-auto overflow-y-hidden lg:block"
      >
        <div
          data-testid="desktop-resizable-panels"
          className="flex h-full"
          style={{
            minWidth: `${minimumDesktopPanelWidth}px`,
            width: "100%",
          }}
        >
          <div
            data-testid="desktop-sources-panel"
            ref={(element) => {
              desktopPanelElements.current.sources = element
            }}
            className="h-full shrink-0"
            style={{
              minWidth: `${DESKTOP_PANEL_MIN_WIDTHS.sources}px`,
              width: `${desktopPanelWidths.sources}px`,
            }}
          >
            <SourcesPanel
              sources={sources}
              onSourceUploaded={isGuest ? undefined : handleSourceUploaded}
              selectedSourceId={selectedSourceId}
              onSelectSource={handleSourceSelected}
              onToggleIncluded={isGuest ? undefined : handleToggleIncluded}
              onArchiveSource={isGuest ? undefined : handleArchiveSource}
              archivingSourceIds={archivingSourceIds}
              onLoginClick={isGuest ? redirectToLogin : undefined}
            />
          </div>
          <DesktopResizeHandle
            label="Resize sources and parsed chunks"
            onResizeStart={() =>
              handleDesktopPanelResizeStart("sources", "chunks")
            }
            onResize={(deltaX) =>
              handleDesktopPanelResize("sources", "chunks", deltaX)
            }
            onResizeEnd={handleDesktopPanelResizeEnd}
          />
          <div
            data-testid="desktop-chunks-panel"
            ref={(element) => {
              desktopPanelElements.current.chunks = element
            }}
            className="h-full min-w-0 shrink-0 grow"
            style={{
              minWidth: `${DESKTOP_PANEL_MIN_WIDTHS.chunks}px`,
              width: `${desktopPanelWidths.chunks}px`,
            }}
          >
            <ChunksPanel
              chunks={selectedChunks}
              selectedSource={selectedSourceTitle}
              selectedSourceFile={selectedSource?.originalFile ?? null}
              focusedChunkId={focusedChunk.chunkId}
              focusedChunkRequestId={focusedChunk.requestId}
              isLoading={isSelectedChunksLoading}
              isLoadingMore={isSelectedChunksLoadingMore}
              hasMoreChunks={hasMoreSelectedChunks}
              onLoadMore={handleLoadMoreChunks}
            />
          </div>
          <DesktopResizeHandle
            label="Resize parsed chunks and chat"
            onResizeStart={() =>
              handleDesktopPanelResizeStart("chunks", "chat")
            }
            onResize={(deltaX) =>
              handleDesktopPanelResize("chunks", "chat", deltaX)
            }
            onResizeEnd={handleDesktopPanelResizeEnd}
          />
          <div
            data-testid="desktop-chat-panel"
            ref={(element) => {
              desktopPanelElements.current.chat = element
            }}
            className="h-full shrink-0"
            style={{
              minWidth: `${DESKTOP_PANEL_MIN_WIDTHS.chat}px`,
              width: `${desktopPanelWidths.chat}px`,
            }}
          >
            <ChatPanel
              messages={chat.messages}
              threads={chatThreads}
              activeThreadId={chat.threadId}
              isDisabled={isGuest || readySourceCount === 0}
              isSending={chat.isSending}
              isHistoryLoading={chat.isLoading}
              isCreatingThread={isCreatingThread}
              loadingThreadId={loadingThreadId}
              archivingThreadIds={archivingThreadIds}
              pendingCitationId={pendingCitationId}
              sourceCount={readySourceCount}
              onSend={handleChatSend}
              onNewChat={isGuest ? undefined : handleCreateChatThread}
              onThreadSelect={isGuest ? undefined : handleSelectChatThread}
              onThreadArchive={isGuest ? undefined : handleArchiveChatThread}
              onCitationClick={handleCitationClick}
              onLoginClick={isGuest ? redirectToLogin : undefined}
              sourceTitlesByDocumentId={sourceTitlesByDocumentId}
            />
          </div>
        </div>
      </div>

      {/* Mobile: single-panel with bottom tab bar. */}
      <div
        id="panel-sources"
        role="tabpanel"
        aria-labelledby="tab-sources"
        className={`lg:hidden flex-1 overflow-hidden pb-14 ${
          mobilePanel === "sources" ? "flex flex-col" : "hidden"
        }`}
      >
        <SourcesPanel
          sources={sources}
          onSourceUploaded={isGuest ? undefined : handleSourceUploaded}
          selectedSourceId={selectedSourceId}
          onSelectSource={(id) => {
            handleSourceSelected(id)
            if (id) setMobilePanel("content")
          }}
          onToggleIncluded={isGuest ? undefined : handleToggleIncluded}
          onArchiveSource={isGuest ? undefined : handleArchiveSource}
          archivingSourceIds={archivingSourceIds}
          onLoginClick={isGuest ? redirectToLogin : undefined}
        />
      </div>
      <div
        id="panel-content"
        role="tabpanel"
        aria-labelledby="tab-content"
        className={`lg:hidden flex-1 overflow-hidden pb-14 ${
          mobilePanel === "content" ? "flex flex-col" : "hidden"
        }`}
      >
        <ChunksPanel
          chunks={selectedChunks}
          selectedSource={selectedSourceTitle}
          selectedSourceFile={selectedSource?.originalFile ?? null}
          focusedChunkId={focusedChunk.chunkId}
          focusedChunkRequestId={focusedChunk.requestId}
          isLoading={isSelectedChunksLoading}
          isLoadingMore={isSelectedChunksLoadingMore}
          hasMoreChunks={hasMoreSelectedChunks}
          onLoadMore={handleLoadMoreChunks}
        />
      </div>
      <div
        id="panel-chat"
        role="tabpanel"
        aria-labelledby="tab-chat"
        className={`lg:hidden flex-1 overflow-hidden pb-14 ${
          mobilePanel === "chat" ? "flex flex-col" : "hidden"
        }`}
      >
        <ChatPanel
          messages={chat.messages}
          threads={chatThreads}
          activeThreadId={chat.threadId}
          isDisabled={isGuest || readySourceCount === 0}
          isSending={chat.isSending}
          isHistoryLoading={chat.isLoading}
          isCreatingThread={isCreatingThread}
          loadingThreadId={loadingThreadId}
          archivingThreadIds={archivingThreadIds}
          pendingCitationId={pendingCitationId}
          sourceCount={readySourceCount}
          onSend={handleChatSend}
          onNewChat={isGuest ? undefined : handleCreateChatThread}
          onThreadSelect={isGuest ? undefined : handleSelectChatThread}
          onThreadArchive={isGuest ? undefined : handleArchiveChatThread}
          onLoginClick={isGuest ? redirectToLogin : undefined}
          sourceTitlesByDocumentId={sourceTitlesByDocumentId}
          onCitationClick={(citation, citationId) => {
            setMobilePanel("content")
            handleCitationClick(citation, citationId)
          }}
        />
      </div>

      <MobileTabBar
        activePanel={mobilePanel}
        onPanelChange={setMobilePanel}
        sourceCount={readySourceCount}
        chunkCount={selectedChunks.length}
        hasMessages={hasMessages}
      />

      {chat.error && (
        <div className="fixed bottom-18 right-4 z-50 max-w-sm rounded-lg border border-destructive/30 bg-background px-4 py-3 text-sm text-destructive shadow-lg lg:bottom-4">
          {chat.error}
        </div>
      )}
    </div>
  )
}

async function fetchChunks(sourceId: string): Promise<ParsedChunkView[]> {
  return workspaceClient.fetchChunks(sourceId)
}

function getSourceChunksKey(
  sourceId: string | null,
  pageIndex: number,
  previousPageData: SourceChunksResponse | null,
): SourceChunksKey | null {
  if (!sourceId) return null
  if (previousPageData && !hasMoreChunkPage(previousPageData)) return null
  return ["source-chunks", sourceId, pageIndex + 1] as const
}

function fetchChunksByKey([
  ,
  sourceId,
  page,
]: SourceChunksKey): Promise<SourceChunksResponse> {
  return workspaceClient.fetchChunkPage(sourceId, page)
}

function hasMoreChunkPages(
  pages: readonly SourceChunksResponse[] | undefined,
): boolean {
  const lastPage = pages?.at(-1)
  return lastPage ? hasMoreChunkPage(lastPage) : false
}

function hasMoreChunkPage(page: SourceChunksResponse): boolean {
  if (!page.pagination) return false
  return page.pagination.page < page.pagination.totalPages
}

function getChatThreadKey(threadId: string): ChatThreadKey {
  return ["chat-thread", threadId] as const
}

function getCachedChatThreadData(
  cache: Cache<unknown>,
  threadId: string,
): ChatThreadDetailResponse | null {
  const cachedState = cache.get(unstable_serialize(getChatThreadKey(threadId)))
  const cachedData = cachedState?.data

  return isChatThreadDetailResponse(cachedData, threadId) ? cachedData : null
}

function isChatThreadDetailResponse(
  value: unknown,
  threadId: string,
): value is ChatThreadDetailResponse {
  if (!value || typeof value !== "object") return false

  const response = value as Partial<ChatThreadDetailResponse>
  return response.requestedThreadId === threadId
}

function hasLoadedChatThreadData(
  value: ChatThreadDetailResponse | null | undefined,
): value is ChatThreadDetailResponse & {
  thread: ChatThreadView
  messages: ChatMessageView[]
} {
  return Boolean(value?.thread && Array.isArray(value.messages))
}

function fetchChatThreadByKey([
  ,
  threadId,
]: ChatThreadKey): Promise<ChatThreadDetailResponse> {
  return workspaceClient.fetchChatThread(threadId)
}

function createChatThreadMutation(): ReturnType<typeof workspaceClient.createChatThread> {
  return workspaceClient.createChatThread()
}

function sendChatMessageMutation(
  _key: string,
  { arg }: { arg: ChatMessageRequest },
): ReturnType<typeof workspaceClient.sendChatMessage> {
  return workspaceClient.sendChatMessage(arg)
}

function archiveSourceMutation(
  _key: string,
  { arg: sourceId }: { arg: string },
): ReturnType<typeof workspaceClient.archiveSource> {
  return workspaceClient.archiveSource(sourceId)
}

function archiveChatThreadMutation(
  _key: string,
  { arg: threadId }: { arg: string },
): ReturnType<typeof workspaceClient.archiveChatThread> {
  return workspaceClient.archiveChatThread(threadId)
}

function hasPendingSources(sources: readonly SourceView[]): boolean {
  return sources.some(
    (source) => source.status === "uploading" || source.status === "parsing",
  )
}

function applySourceQueryState(
  sources: readonly SourceView[],
  sourceExclusionById: Readonly<Record<string, boolean>>,
): SourceView[] {
  return sources.map((source) => ({
    ...source,
    excludedFromQuery:
      sourceExclusionById[source.id] ?? source.excludedFromQuery,
  }))
}

function upsertSource(
  sources: readonly SourceView[],
  source: SourceView,
): SourceView[] {
  return [source, ...sources.filter((candidate) => candidate.id !== source.id)]
}

function removeRecordKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Record<string, T> {
  const remaining: Record<string, T> = {}
  Object.entries(record).forEach(([recordKey, value]) => {
    if (recordKey !== key) remaining[recordKey] = value
  })
  return remaining
}

function getInitialChatThreadData(
  threadId: string | null,
  chatThreads: readonly ChatThreadView[],
  messages: readonly ChatMessageView[],
): ChatThreadDetailResponse | undefined {
  if (!threadId) return undefined
  const thread = chatThreads.find((candidate) => candidate.id === threadId)
  if (!thread) return undefined
  return { requestedThreadId: threadId, thread, messages: [...messages] }
}

function addPendingId(currentIds: readonly string[], id: string): string[] {
  return currentIds.includes(id) ? [...currentIds] : [...currentIds, id]
}

function removePendingId(currentIds: readonly string[], id: string): string[] {
  return currentIds.filter((currentId) => currentId !== id)
}

function upsertThread(
  threads: readonly ChatThreadView[],
  thread: ChatThreadView,
): ChatThreadView[] {
  return [thread, ...threads.filter((candidate) => candidate.id !== thread.id)]
}

function upsertThreadAfterSend(
  threads: readonly ChatThreadView[],
  threadId: string,
  firstUserMessage: string,
): ChatThreadView[] {
  const now = new Date().toISOString()
  const existingThread = threads.find((thread) => thread.id === threadId)
  const thread: ChatThreadView = existingThread
    ? {
        ...existingThread,
        title:
          existingThread.title === "New chat"
            ? deriveChatThreadTitle(firstUserMessage)
            : existingThread.title,
        updatedAt: now,
      }
    : {
        id: threadId,
        title: deriveChatThreadTitle(firstUserMessage),
        createdAt: now,
        updatedAt: now,
      }

  return [
    thread,
    ...threads.filter((candidate) => candidate.id !== threadId),
  ]
}

function initialsOf(user: WorkspaceShellProps["user"]): string {
  if (!user) return "?"
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
  label: string
  onResize: (deltaX: number) => void
  onResizeEnd?: () => void
  onResizeStart?: () => void
}) {
  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault()
    const startClientX = event.clientX
    onResizeStart?.()

    function handlePointerMove(moveEvent: PointerEvent): void {
      const deltaX = moveEvent.clientX - startClientX
      onResize(deltaX)
    }

    function handlePointerUp(): void {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      onResizeEnd?.()
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  return (
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      className="group flex h-full shrink-0 cursor-col-resize items-center justify-center border-x border-transparent bg-border/40 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      style={{ width: `${DESKTOP_PANEL_GUTTER_WIDTH}px` }}
      onPointerDown={handlePointerDown}
    >
      <span className="h-10 w-0.5 rounded-full bg-muted-foreground/35 group-hover:bg-primary/60" />
    </button>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
