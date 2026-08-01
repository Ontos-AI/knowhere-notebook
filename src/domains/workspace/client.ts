import type { ChatDiagramSpec } from "@/domains/chat/diagram"
import type { RetrievalOverrides } from "@/domains/chat/contracts"
import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"
import { workspaceRouteClient } from "./route-client"

const workspaceClientKeys = {
  sources: "/api/sources",
  chatThreads: "/api/chat/threads",
  chatDiagram: "/api/chat/diagram",
  chat: "/api/chat",
  namespaces: "/api/namespaces",
  archiveSource: "archive-source",
  retrySource: "retry-source",
  archiveChatThread: "archive-chat-thread",
} as const

const workspaceClientConfig = {
  sourceChunkPageSize: 50,
} as const

type SourceChunksResponse = {
  chunks?: ParsedChunkView[]
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type ChatThreadResponse = {
  thread?: ChatThreadView
  messages?: ChatMessageView[]
  message?: string
}

type ChatThreadDetailResponse = ChatThreadResponse & {
  requestedThreadId: string
}

type ChatMessageRequest = {
  message: string
  threadId?: string
  excludedSourceIds: string[]
  retrievalParams?: RetrievalOverrides
}

type SourcesResponse = {
  sources?: SourceView[]
}

type ChatThreadsResponse = {
  threads?: ChatThreadView[]
}

type ChatMessageResponse = {
  threadId?: string
  messages?: ChatMessageView[]
  message?: string
}

type ChatDiagramRequest = {
  answer: string
}

type ChatDiagramResponse = {
  diagram?: ChatDiagramSpec
  message?: string
}

type ArchiveResponse = {
  id?: string
  archived?: boolean
}

type RetrySourceResponse = {
  source?: SourceView
  message?: string
}

type NamespaceView = {
  namespace: string
  documentCount: number
}

type NamespacesResponse = {
  namespaces?: NamespaceView[]
}

type LocalizeNamespaceResponse = {
  sources?: SourceView[]
  message?: string
}

export const workspaceClient = {
  keys: workspaceClientKeys,
  fetchChunks,
  fetchChunkPage,
  fetchSources,
  fetchChatThreads,
  fetchChatThread,
  createChatThread,
  createChatDiagram,
  sendChatMessage,
  fetchNamespaces,
  localizeNamespace,
  archiveSource,
  retrySource,
  archiveChatThread,
} as const

async function fetchChunks(sourceId: string): Promise<ParsedChunkView[]> {
  try {
    const body = await workspaceRouteClient.getJson<{
      chunks?: ParsedChunkView[]
    }>(
      `/api/sources/${encodeURIComponent(sourceId)}/chunks`,
    )
    return Array.isArray(body.chunks) ? body.chunks : []
  } catch {
    return []
  }
}

async function fetchChunkPage(
  sourceId: string,
  page: number,
): Promise<SourceChunksResponse> {
  const searchParams = new URLSearchParams({
    page: String(page),
    pageSize: String(workspaceClientConfig.sourceChunkPageSize),
  })
  const body = await workspaceRouteClient.getJson<SourceChunksResponse>(
    `/api/sources/${encodeURIComponent(sourceId)}/chunks?${searchParams.toString()}`,
  )

  return {
    chunks: Array.isArray(body.chunks) ? body.chunks : [],
    pagination: body.pagination,
  }
}

async function fetchSources(): Promise<SourceView[]> {
  const body = await workspaceRouteClient.getJson<SourcesResponse>(
    workspaceClientKeys.sources,
  )
  return Array.isArray(body.sources) ? body.sources : []
}

async function fetchChatThreads(): Promise<ChatThreadView[]> {
  const body = await workspaceRouteClient.getJson<ChatThreadsResponse>(
    workspaceClientKeys.chatThreads,
  )
  return Array.isArray(body.threads) ? body.threads : []
}

async function fetchChatThread(
  threadId: string,
): Promise<ChatThreadDetailResponse> {
  const body = await workspaceRouteClient.getJson<ChatThreadResponse>(
    `/api/chat/threads/${encodeURIComponent(threadId)}`,
  )
  return { ...body, requestedThreadId: threadId }
}

function createChatThread(): Promise<ChatThreadResponse> {
  return workspaceRouteClient.postJson<ChatThreadResponse>(
    workspaceClientKeys.chatThreads,
    {},
  )
}

function createChatDiagram(
  input: ChatDiagramRequest,
): Promise<ChatDiagramResponse> {
  return workspaceRouteClient.postJson<ChatDiagramResponse>(
    workspaceClientKeys.chatDiagram,
    input,
  )
}

function sendChatMessage(
  input: ChatMessageRequest,
): Promise<ChatMessageResponse> {
  return workspaceRouteClient.postJson<ChatMessageResponse>(
    workspaceClientKeys.chat,
    input,
  )
}

function archiveSource(sourceId: string): Promise<ArchiveResponse> {
  return workspaceRouteClient.patchJson(
    `/api/sources/${encodeURIComponent(sourceId)}`,
    {
      archived: true,
    },
  )
}

async function retrySource(sourceId: string): Promise<SourceView> {
  const response = await workspaceRouteClient.patchJsonWithStatus<
    RetrySourceResponse
  >(`/api/sources/${encodeURIComponent(sourceId)}`, {
    retry: true,
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.body.message ?? "Source could not be retried.")
  }
  if (!response.body.source) {
    throw new Error("Source could not be retried.")
  }

  return response.body.source
}

function archiveChatThread(threadId: string): Promise<ArchiveResponse> {
  return workspaceRouteClient.patchJson(
    `/api/chat/threads/${encodeURIComponent(threadId)}`,
    {
      archived: true,
    },
  )
}

async function fetchNamespaces(): Promise<NamespaceView[]> {
  const body = await workspaceRouteClient.getJson<NamespacesResponse>(
    workspaceClientKeys.namespaces,
  )
  return Array.isArray(body.namespaces) ? body.namespaces : []
}

async function localizeNamespace(namespace: string): Promise<SourceView[]> {
  const response = await workspaceRouteClient.postJsonWithStatus<
    LocalizeNamespaceResponse
  >(
    `/api/namespaces/${encodeURIComponent(namespace)}/localize`,
    {},
  )
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      response.body.message ?? "Could not import documents from this namespace.",
    )
  }
  return Array.isArray(response.body.sources) ? response.body.sources : []
}
