"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactElement } from "react"
import useSWR, { SWRConfig, useSWRConfig } from "swr"
import useSWRMutation from "swr/mutation"
import {
  WorkspaceShellLayout,
  type PanelId,
} from "@/components/workspace-shell-layout"
import { useWorkspaceDesktopPanels } from "@/components/workspace-desktop-panels"
import { useWorkspaceSelectedChunks } from "@/components/workspace-selected-chunks"
import { workspaceShellState } from "@/components/workspace-shell-state"
import { workspaceSourceState } from "@/components/workspace-source-state"
import { workspaceChatState } from "@/components/workspace-chat-state"
import { workspaceCitationState } from "@/components/workspace-citation-state"
import {
  workspaceShellClient,
  type ChatThreadDetailResponse,
} from "@/components/workspace-shell-client"
import { useHashFragment } from "@/lib/use-hash-fragment"
import type {
  ChatCitationView,
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

const sourcesSWRKey = workspaceShellClient.keys.sources
const chatThreadsSWRKey = workspaceShellClient.keys.chatThreads
const chatSWRKey = workspaceShellClient.keys.chat
const archiveSourceSWRKey = workspaceShellClient.keys.archiveSource
const archiveChatThreadSWRKey = workspaceShellClient.keys.archiveChatThread

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
  isGuest = false,
  loginUrl,
}: WorkspaceShellProps): ReactElement {
  const initialSrcs = initialSources ?? []
  const initialSelectedSourceId = workspaceSourceState.getInitialSelectedSourceId(
    initialSrcs,
    isGuest,
  )

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
  const [chat, setChat] = useState<ChatState>(
    workspaceChatState.createInitialState(
      activeChatThreadId ?? null,
      initialChatMessages ?? [],
    ),
  )
  const optimisticMessageSequence = useRef(0)
  const { cache, mutate: mutateSWR } = useSWRConfig()
  const { data: serverSources, mutate: mutateSources } = useSWR(
    sourcesSWRKey,
    workspaceShellClient.fetchSources,
    {
      fallbackData: initialSrcs,
      revalidateIfStale: false,
      revalidateOnMount: false,
      refreshInterval: (currentSources) =>
        workspaceShellClient.hasPendingSources(currentSources ?? []) ? 3000 : 0,
    },
  )
  const sourceRows = serverSources ?? initialSrcs
  const sources = workspaceSourceState.applyQueryExclusions(
    sourceRows,
    sourceExclusionById,
  )
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
    workspaceShellClient.fetchChatThreads,
    {
      fallbackData: initialChatThreads ?? [],
      revalidateIfStale: false,
      revalidateOnMount: false,
    },
  )
  const chatThreads = serverChatThreads ?? initialChatThreads ?? []
  const {
    hasMoreSelectedChunks,
    handleLoadMoreChunks,
    isSelectedChunksLoading,
    isSelectedChunksLoadingMore,
    selectedChunks,
    selectedSource,
  } = useWorkspaceSelectedChunks({
    selectedSourceId,
    sources,
    prefetchedChunksBySourceId,
  })
  const initialChatThreadData = useMemo(
    () =>
      workspaceChatState.getInitialThreadData(
        activeChatThreadId ?? null,
        initialChatThreads ?? [],
        initialChatMessages ?? [],
      ),
    [activeChatThreadId, initialChatMessages, initialChatThreads],
  )
  const activeChatThreadKey = chat.threadId
    ? workspaceShellClient.getChatThreadKey(chat.threadId)
    : null
  useSWR(
    activeChatThreadKey,
    workspaceShellClient.fetchChatThreadByKey,
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
    useSWRMutation(chatThreadsSWRKey, workspaceShellClient.createChatThreadMutation)
  const { trigger: sendChatMessage } = useSWRMutation(
    chatSWRKey,
    workspaceShellClient.sendChatMessageMutation,
  )
  const { trigger: archiveSource } = useSWRMutation(
    archiveSourceSWRKey,
    workspaceShellClient.archiveSourceMutation,
  )
  const { trigger: archiveChatThread } = useSWRMutation(
    archiveChatThreadSWRKey,
    workspaceShellClient.archiveChatThreadMutation,
  )
  const {
    desktopPanelWidths,
    minimumDesktopPanelWidth,
    handleDesktopPanelElementChange,
    handleDesktopPanelResize,
    handleDesktopPanelResizeEnd,
    handleDesktopPanelResizeStart,
  } = useWorkspaceDesktopPanels()

  function redirectToLogin(): void {
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

  const selectedSourceTitle = selectedSource?.title ?? null

  function handleChatThreadLoaded(body: ChatThreadDetailResponse): void {
    const requestedThreadId = body.requestedThreadId

    setChat((current) => workspaceChatState.loadThread(current, body))
    setLoadingThreadId((current) =>
      current === requestedThreadId ? null : current,
    )
  }

  function handleChatThreadLoadFailed(): void {
    setChat((current) => workspaceChatState.failLoad(current))
    setLoadingThreadId(null)
  }

  function handleSourceUploaded(source: SourceView): void {
    void mutateSources(
      (current) =>
        workspaceSourceState.upsertSource(current ?? sourceRows, source),
      { revalidate: false },
    )
    void mutateSources()
  }

  function handleToggleIncluded(sourceId: string, included: boolean): void {
    setSourceExclusionById((current) => ({
      ...current,
      [sourceId]: !included,
    }))
  }

  async function handleArchiveSource(sourceId: string): Promise<void> {
    setArchivingSourceIds((current) =>
      workspaceSourceState.addPendingId(current, sourceId),
    )
    try {
      await archiveSource(sourceId)
      void mutateSources(
        (current) =>
          (current ?? sourceRows).filter((source) => source.id !== sourceId),
        { revalidate: false },
      )
      setSelectedSourceId((current) =>
        workspaceSourceState.archiveSource({
          sourceId,
          selectedSourceId: current,
          sourceExclusionById,
        }).selectedSourceId,
      )
      setSourceExclusionById((current) =>
        workspaceSourceState.archiveSource({
          sourceId,
          selectedSourceId,
          sourceExclusionById: current,
        }).sourceExclusionById,
      )
    } catch {
      // Silently ignore — the source stays in the list.
    } finally {
      setArchivingSourceIds((current) =>
        workspaceSourceState.removePendingId(current, sourceId),
      )
    }
  }

  async function handleCreateChatThread(): Promise<void> {
    if (isCreatingThread) return

    try {
      const body = await createChatThread()

      if (!body.thread || !Array.isArray(body.messages)) {
        setChat((current) => workspaceChatState.failCreate(current, body.message))
        return
      }

      void mutateChatThreads(
        (current = []) => workspaceChatState.upsertThread(current, body.thread!),
        { revalidate: false },
      )
      void mutateSWR(
        workspaceShellClient.getChatThreadKey(body.thread.id),
        { ...body, requestedThreadId: body.thread.id },
        { revalidate: false },
      )
      setChat(workspaceChatState.createThread(body.thread.id, body.messages))
    } catch {
      setChat((current) => workspaceChatState.failCreate(current))
    }
  }

  function handleSelectChatThread(threadId: string): void {
    if (threadId === chat.threadId) return

    const cachedThreadData =
      workspaceShellClient.getCachedChatThreadData(cache, threadId) ??
      (threadId === activeChatThreadId ? initialChatThreadData : null)

    if (workspaceShellClient.hasLoadedChatThreadData(cachedThreadData)) {
      void mutateSWR(
        workspaceShellClient.getChatThreadKey(threadId),
        cachedThreadData,
        { revalidate: false },
      )
      setLoadingThreadId(null)
      setChat(workspaceChatState.selectThread({
        current: chat,
        threadId,
        loadedMessages: cachedThreadData.messages,
      }))
      return
    }

    setLoadingThreadId(threadId)
    setChat((current) =>
      workspaceChatState.selectThread({
        current,
        threadId,
      }),
    )
  }

  async function handleArchiveChatThread(threadId: string): Promise<void> {
    setArchivingThreadIds((current) =>
      workspaceChatState.addPendingId(current, threadId),
    )
    try {
      await archiveChatThread(threadId)
      const remainingThreads = chatThreads.filter(
        (thread) => thread.id !== threadId,
      )
      void mutateChatThreads(remainingThreads, { revalidate: false })

      if (chat.threadId !== threadId) return

      const nextThread = remainingThreads[0] ?? null
      if (!nextThread) {
        setChat(workspaceChatState.clearThread())
        return
      }

      handleSelectChatThread(nextThread.id)
    } catch {
      setChat((current) => workspaceChatState.failArchive(current))
    } finally {
      setArchivingThreadIds((current) =>
        workspaceChatState.removePendingId(current, threadId),
      )
    }
  }

  function handleSourceSelected(sourceId: string | null): void {
    setSelectedSourceId(sourceId)
    if (sourceId) {
      setPrefetchedChunksBySourceId((current) =>
        workspaceSourceState.removeRecordKey(current, sourceId),
      )
    }
    requestChunkFocus(null)
  }

  async function handleChatSend(text: string): Promise<void> {
    optimisticMessageSequence.current += 1
    const optimisticId = `pending-${optimisticMessageSequence.current}`
    setChat((current) =>
      workspaceChatState.addOptimisticUserMessage(current, {
        id: optimisticId,
        content: text,
      }),
    )
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
          ...workspaceChatState.failSend(current, optimisticId),
          error: body.message ?? "The assistant could not answer right now.",
        }))
        return
      }

      void mutateChatThreads(
        (current = []) =>
          workspaceChatState.upsertThreadAfterSend(
            current,
            body.threadId!,
            text,
          ),
        { revalidate: false },
      )
      setChat((current) =>
        workspaceChatState.completeSend(current, body.threadId!, body.messages!),
      )
      const nextThread = workspaceChatState.upsertThreadAfterSend(
        chatThreads,
        body.threadId,
        text,
      )[0]
      if (nextThread) {
        void mutateSWR(
          workspaceShellClient.getChatThreadKey(body.threadId),
          {
            requestedThreadId: body.threadId,
            thread: nextThread,
            messages: body.messages,
          },
          { revalidate: false },
        )
      }
    } catch {
      setChat((current) => workspaceChatState.failSend(current, optimisticId))
    }
  }

  async function handleCitationClick(
    citation: ChatCitationView,
    citationId: string,
  ): Promise<void> {
    setPendingCitationId(citationId)

    try {
      const source = workspaceCitationState.findCitationSource(
        sources,
        citation,
      )
      if (!source) return

      const loadedChunkId = workspaceCitationState.getLoadedCitationChunkId({
        citation,
        selectedSourceId,
        sourceId: source.id,
        selectedChunks,
        hasMoreSelectedChunks,
      })
      if (loadedChunkId) {
        requestChunkFocus(loadedChunkId)
        return
      }

      requestChunkFocus(null)
      const chunks = await workspaceShellClient.fetchChunks(source.id)
      setPrefetchedChunksBySourceId((current) =>
        workspaceCitationState.upsertPrefetchedChunks(
          current,
          source.id,
          chunks,
        ),
      )
      const prefetchedChunkId =
        workspaceCitationState.getLoadedCitationChunkId({
          citation,
          selectedSourceId: source.id,
          sourceId: source.id,
          selectedChunks: chunks,
          hasMoreSelectedChunks: false,
        })
      setSelectedSourceId(source.id)
      requestChunkFocus(prefetchedChunkId)
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
    <WorkspaceShellLayout
      archivingSourceIds={archivingSourceIds}
      archivingThreadIds={archivingThreadIds}
      chat={chat}
      chatThreads={chatThreads}
      desktopPanelWidths={desktopPanelWidths}
      focusedChunk={focusedChunk}
      hasMessages={hasMessages}
      hasMoreSelectedChunks={hasMoreSelectedChunks}
      isCreatingThread={isCreatingThread}
      isGuest={isGuest}
      isSelectedChunksLoading={isSelectedChunksLoading}
      isSelectedChunksLoadingMore={isSelectedChunksLoadingMore}
      loadingThreadId={loadingThreadId}
      minimumDesktopPanelWidth={minimumDesktopPanelWidth}
      mobilePanel={mobilePanel}
      pendingCitationId={pendingCitationId}
      readySourceCount={readySourceCount}
      selectedChunks={selectedChunks}
      selectedSourceFile={selectedSource?.originalFile ?? null}
      selectedSourceId={selectedSourceId}
      selectedSourceTitle={selectedSourceTitle}
      sourceTitlesByDocumentId={sourceTitlesByDocumentId}
      sources={sources}
      user={user}
      onArchiveChatThread={handleArchiveChatThread}
      onArchiveSource={handleArchiveSource}
      onChatSend={handleChatSend}
      onCitationClick={handleCitationClick}
      onCreateChatThread={handleCreateChatThread}
      onDesktopPanelElementChange={handleDesktopPanelElementChange}
      onDesktopPanelResize={handleDesktopPanelResize}
      onDesktopPanelResizeEnd={handleDesktopPanelResizeEnd}
      onDesktopPanelResizeStart={handleDesktopPanelResizeStart}
      onLoadMoreChunks={handleLoadMoreChunks}
      onLoginClick={redirectToLogin}
      onMobilePanelChange={setMobilePanel}
      onSelectChatThread={handleSelectChatThread}
      onSourceSelected={handleSourceSelected}
      onSourceUploaded={handleSourceUploaded}
      onToggleIncluded={handleToggleIncluded}
    />
  )
}
