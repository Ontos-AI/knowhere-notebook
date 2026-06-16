"use client"

import { useMemo, useRef, useState } from "react"
import useSWR, { useSWRConfig } from "swr"
import useSWRMutation from "swr/mutation"

import { workspaceChatState } from "@/components/workspace-chat-state"
import { workspaceClient } from "@/domains/workspace/client"
import {
  workspaceClientCache,
  type ChatThreadDetailResponse,
  type ChatThreadKey,
} from "@/domains/workspace/client-cache"
import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { SourceView } from "@/domains/sources/types"

type WorkspaceChatWorkflowInput = {
  readonly activeChatThreadId?: string | null
  readonly initialChatMessages?: readonly ChatMessageView[]
  readonly initialChatThreads?: readonly ChatThreadView[]
  readonly isGuest?: boolean
  readonly onSourcesMaterialized?: (
    demoSourceIds: readonly string[],
    materializedSources: readonly SourceView[],
  ) => void
  readonly sources: readonly SourceView[]
}

type ChatMessageRequest = Parameters<typeof workspaceClient.sendChatMessage>[0]

type WorkspaceChatWorkflow = {
  readonly archivingThreadIds: string[]
  readonly chat: ReturnType<typeof workspaceChatState.createInitialState>
  readonly chatThreads: ChatThreadView[]
  readonly handleArchiveChatThread: (threadId: string) => Promise<void>
  readonly handleChatSend: (text: string) => Promise<void>
  readonly handleCreateChatThread: () => Promise<void>
  readonly handleRefreshActiveChatThread: () => Promise<void>
  readonly handleSelectChatThread: (threadId: string) => void
  readonly isCreatingThread: boolean
  readonly loadingThreadId: string | null
}

const chatThreadsSWRKey = workspaceClient.keys.chatThreads
const chatSWRKey = workspaceClient.keys.chat
const archiveChatThreadSWRKey = workspaceClient.keys.archiveChatThread

export function useWorkspaceChatWorkflow({
  activeChatThreadId = null,
  initialChatMessages = [],
  initialChatThreads = [],
  isGuest = false,
  onSourcesMaterialized,
  sources,
}: WorkspaceChatWorkflowInput): WorkspaceChatWorkflow {
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null)
  const [archivingThreadIds, setArchivingThreadIds] = useState<string[]>([])
  const [chat, setChat] = useState(
    workspaceChatState.createInitialState(
      activeChatThreadId,
      initialChatMessages,
    ),
  )
  const optimisticMessageSequence = useRef(0)
  const { cache, mutate: mutateSWR } = useSWRConfig()
  const initialThreadRows = useMemo(
    () => [...initialChatThreads],
    [initialChatThreads],
  )
  const { data: serverChatThreads, mutate: mutateChatThreads } = useSWR(
    isGuest ? null : chatThreadsSWRKey,
    workspaceClient.fetchChatThreads,
    {
      fallbackData: initialThreadRows,
      revalidateIfStale: false,
      revalidateOnMount: false,
    },
  )
  const chatThreads = serverChatThreads ?? initialThreadRows
  const initialChatThreadData = useMemo(
    () =>
      workspaceChatState.getInitialThreadData(
        activeChatThreadId,
        initialChatThreads,
        initialChatMessages,
      ),
    [activeChatThreadId, initialChatMessages, initialChatThreads],
  )
  const activeChatThreadKey = chat.threadId
    ? workspaceClientCache.getChatThreadKey(chat.threadId)
    : null

  useSWR(activeChatThreadKey, fetchChatThreadByKey, {
    fallbackData:
      chat.threadId === activeChatThreadId ? initialChatThreadData : undefined,
    revalidateIfStale: false,
    revalidateOnMount: false,
    onSuccess: handleChatThreadLoaded,
    onError: handleChatThreadLoadFailed,
  })

  const { trigger: createChatThread, isMutating: isCreatingThread } =
    useSWRMutation(chatThreadsSWRKey, createChatThreadMutation)
  const { trigger: sendChatMessage } = useSWRMutation(
    chatSWRKey,
    sendChatMessageMutation,
  )
  const { trigger: archiveChatThread } = useSWRMutation(
    archiveChatThreadSWRKey,
    archiveChatThreadMutation,
  )

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
        workspaceClientCache.getChatThreadKey(body.thread.id),
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
      workspaceClientCache.getCachedChatThreadData(cache, threadId) ??
      (threadId === activeChatThreadId ? initialChatThreadData : null)

    if (workspaceClientCache.hasLoadedChatThreadData(cachedThreadData)) {
      void mutateSWR(
        workspaceClientCache.getChatThreadKey(threadId),
        cachedThreadData,
        { revalidate: false },
      )
      setLoadingThreadId(null)
      setChat(
        workspaceChatState.selectThread({
          current: chat,
          threadId,
          loadedMessages: cachedThreadData.messages,
        }),
      )
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

  async function handleRefreshActiveChatThread(): Promise<void> {
    const threadId = chat.threadId
    if (!threadId) return

    try {
      const fresh = await workspaceClient.fetchChatThread(threadId)
      if (!fresh.thread || !Array.isArray(fresh.messages)) return
      const messages = fresh.messages

      void mutateSWR(
        workspaceClientCache.getChatThreadKey(threadId),
        fresh,
        { revalidate: false },
      )
      setChat((current) => {
        if (current.threadId !== fresh.requestedThreadId) return current
        return { ...current, messages: [...messages] }
      })
    } catch {
      // Materialization can still succeed even if the current thread refresh fails.
    }
  }

  async function handleChatSend(text: string): Promise<void> {
    const demoSourceIds = getMaterializableDemoSourceIds(sources)
    if (demoSourceIds.length > 0) {
      setChat((current) =>
        workspaceChatState.prepareSend(current, "Thinking"),
      )
      try {
        const materializedSources =
          await workspaceClient.materializeDemoSources({ demoSourceIds })
        onSourcesMaterialized?.(demoSourceIds, materializedSources)
        await handleRefreshActiveChatThread()
      } catch {
        setChat((current) => ({
          ...current,
          isSending: false,
          isLoading: false,
          pendingStatusText: null,
          error: "Demo sources could not be prepared right now.",
        }))
        return
      }
    }

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
          workspaceClientCache.getChatThreadKey(body.threadId),
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

  return {
    archivingThreadIds,
    chat,
    chatThreads,
    handleArchiveChatThread,
    handleChatSend,
    handleCreateChatThread,
    handleRefreshActiveChatThread,
    handleSelectChatThread,
    isCreatingThread,
    loadingThreadId,
  }
}

function getMaterializableDemoSourceIds(
  sources: readonly SourceView[],
): string[] {
  const demoSourceIds = sources
    .filter((source) => source.kind === "demo")
    .filter((source) => source.officialLibrary === undefined)
    .filter((source) => !source.excludedFromQuery)
    .map((source) => source.demoSourceId ?? source.id)

  return Array.from(new Set(demoSourceIds))
}

function fetchChatThreadByKey([
  ,
  threadId,
]: ChatThreadKey): Promise<ChatThreadDetailResponse> {
  return workspaceClient.fetchChatThread(threadId)
}

function createChatThreadMutation(): ReturnType<
  typeof workspaceClient.createChatThread
> {
  return workspaceClient.createChatThread()
}

function sendChatMessageMutation(
  _key: string,
  { arg }: { readonly arg: ChatMessageRequest },
): ReturnType<typeof workspaceClient.sendChatMessage> {
  return workspaceClient.sendChatMessage(arg)
}

function archiveChatThreadMutation(
  _key: string,
  { arg: threadId }: { readonly arg: string },
): ReturnType<typeof workspaceClient.archiveChatThread> {
  return workspaceClient.archiveChatThread(threadId)
}
