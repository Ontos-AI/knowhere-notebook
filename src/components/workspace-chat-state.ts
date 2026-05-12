import { deriveChatThreadTitle } from "@/domains/chat/title"

import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"

type ChatState = {
  readonly threadId: string | null
  readonly messages: ChatMessageView[]
  readonly isSending: boolean
  readonly isLoading: boolean
  readonly error: string | null
}

type LoadedChatThreadData = {
  readonly requestedThreadId: string
  readonly thread?: ChatThreadView
  readonly messages?: ChatMessageView[]
  readonly message?: string
}

type SelectThreadInput = {
  readonly current: ChatState
  readonly threadId: string
  readonly loadedMessages?: readonly ChatMessageView[] | null
}

type OptimisticUserMessageInput = {
  readonly id: string
  readonly content: string
}

type WorkspaceChatStateModule = {
  readonly createInitialState: (
    threadId: string | null,
    messages: readonly ChatMessageView[],
  ) => ChatState
  readonly getInitialThreadData: (
    threadId: string | null,
    chatThreads: readonly ChatThreadView[],
    messages: readonly ChatMessageView[],
  ) => LoadedChatThreadData | undefined
  readonly loadThread: (
    current: ChatState,
    body: LoadedChatThreadData,
  ) => ChatState
  readonly failLoad: (current: ChatState) => ChatState
  readonly selectThread: (input: SelectThreadInput) => ChatState
  readonly createThread: (
    threadId: string,
    messages: readonly ChatMessageView[],
  ) => ChatState
  readonly failCreate: (current: ChatState, message?: string | null) => ChatState
  readonly addOptimisticUserMessage: (
    current: ChatState,
    message: OptimisticUserMessageInput,
  ) => ChatState
  readonly completeSend: (
    current: ChatState,
    threadId: string,
    messages: readonly ChatMessageView[],
  ) => ChatState
  readonly failSend: (current: ChatState, optimisticId: string) => ChatState
  readonly clearThread: () => ChatState
  readonly failArchive: (current: ChatState) => ChatState
  readonly upsertThread: (
    threads: readonly ChatThreadView[],
    thread: ChatThreadView,
  ) => ChatThreadView[]
  readonly upsertThreadAfterSend: (
    threads: readonly ChatThreadView[],
    threadId: string,
    firstUserMessage: string,
  ) => ChatThreadView[]
  readonly addPendingId: (currentIds: readonly string[], id: string) => string[]
  readonly removePendingId: (
    currentIds: readonly string[],
    id: string,
  ) => string[]
}

const chatLoadError = "The chat could not be loaded right now."
const chatCreateError = "The chat could not be created right now."
const chatSendError = "The assistant could not answer right now."
const chatArchiveError = "The chat could not be deleted right now."

function createInitialState(
  threadId: string | null,
  messages: readonly ChatMessageView[],
): ChatState {
  return {
    threadId,
    messages: [...messages],
    isSending: false,
    isLoading: false,
    error: null,
  }
}

function getInitialThreadData(
  threadId: string | null,
  chatThreads: readonly ChatThreadView[],
  messages: readonly ChatMessageView[],
): LoadedChatThreadData | undefined {
  if (!threadId) return undefined
  const thread = chatThreads.find((candidate) => candidate.id === threadId)
  if (!thread) return undefined
  return { requestedThreadId: threadId, thread, messages: [...messages] }
}

function loadThread(
  current: ChatState,
  body: LoadedChatThreadData,
): ChatState {
  if (current.threadId !== body.requestedThreadId) return current

  if (!body.thread || !Array.isArray(body.messages)) {
    return {
      ...current,
      isLoading: false,
      error: body.message ?? chatLoadError,
    }
  }

  return {
    ...current,
    messages: [...body.messages],
    isLoading: false,
    error: null,
  }
}

function failLoad(current: ChatState): ChatState {
  return {
    ...current,
    isLoading: false,
    error: chatLoadError,
  }
}

function selectThread(input: SelectThreadInput): ChatState {
  if (input.loadedMessages) {
    return {
      threadId: input.threadId,
      messages: [...input.loadedMessages],
      isSending: false,
      isLoading: false,
      error: null,
    }
  }

  return {
    ...input.current,
    threadId: input.threadId,
    isLoading: true,
    error: null,
  }
}

function createThread(
  threadId: string,
  messages: readonly ChatMessageView[],
): ChatState {
  return {
    threadId,
    messages: [...messages],
    isSending: false,
    isLoading: false,
    error: null,
  }
}

function failCreate(current: ChatState, message?: string | null): ChatState {
  return {
    ...current,
    error: message ?? chatCreateError,
  }
}

function addOptimisticUserMessage(
  current: ChatState,
  message: OptimisticUserMessageInput,
): ChatState {
  const optimisticUser: ChatMessageView = {
    id: message.id,
    role: "user",
    content: message.content,
  }

  return {
    ...current,
    isSending: true,
    error: null,
    messages: [...current.messages, optimisticUser],
  }
}

function completeSend(
  current: ChatState,
  threadId: string,
  messages: readonly ChatMessageView[],
): ChatState {
  const assistantMessages = messages.filter(
    (message) => message.role === "assistant",
  )

  return {
    threadId,
    messages: [...current.messages, ...assistantMessages],
    isSending: false,
    isLoading: false,
    error: null,
  }
}

function failSend(current: ChatState, optimisticId: string): ChatState {
  return {
    ...current,
    isSending: false,
    isLoading: false,
    messages: current.messages.filter((message) => message.id !== optimisticId),
    error: chatSendError,
  }
}

function clearThread(): ChatState {
  return {
    threadId: null,
    messages: [],
    isSending: false,
    isLoading: false,
    error: null,
  }
}

function failArchive(current: ChatState): ChatState {
  return {
    ...current,
    error: chatArchiveError,
  }
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

function addPendingId(currentIds: readonly string[], id: string): string[] {
  return currentIds.includes(id) ? [...currentIds] : [...currentIds, id]
}

function removePendingId(currentIds: readonly string[], id: string): string[] {
  return currentIds.filter((currentId) => currentId !== id)
}

export const workspaceChatState: WorkspaceChatStateModule = {
  createInitialState,
  getInitialThreadData,
  loadThread,
  failLoad,
  selectThread,
  createThread,
  failCreate,
  addOptimisticUserMessage,
  completeSend,
  failSend,
  clearThread,
  failArchive,
  upsertThread,
  upsertThreadAfterSend,
  addPendingId,
  removePendingId,
}
