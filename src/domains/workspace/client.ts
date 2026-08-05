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


export type KnowhereKeyLabelView = {
  id: string
  label: string
  mask: string
}


export type WorkspaceView = {
  id: string
  namespace: string
  activeKeyLabel?: string | null
}

type CreateWorkspaceResponse = {
  workspace?: WorkspaceView
  message?: string
}

export type WorkspaceApiKeyView = KnowhereKeyLabelView & {
  createdAt: string
}

type WorkspaceApiKeysResponse = {
  keys?: WorkspaceApiKeyView[]
  key?: WorkspaceApiKeyView
  workspace?: WorkspaceView | null
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
  fetchUserApiKeys,
  createUserApiKey,
  fetchApiKeyNamespaces,
  activateWorkspace,
  createWorkspace,
  setActiveWorkspaceApiKey,
  deleteUserApiKey,
  archiveSource,
  retrySource,
  archiveChatThread,
  fetchWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
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

async function fetchUserApiKeys(): Promise<WorkspaceApiKeyView[]> {
  const body = await workspaceRouteClient.getJson<WorkspaceApiKeysResponse>(
    "/api/api-keys",
  )
  return Array.isArray(body.keys) ? body.keys : []
}

async function createUserApiKey(
  label: string,
  apiKey: string,
): Promise<{ key: WorkspaceApiKeyView; workspace: WorkspaceView | null }> {
  const response = await workspaceRouteClient.postJsonWithStatus<
    WorkspaceApiKeysResponse
  >("/api/api-keys", { label, apiKey })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.body.message ?? "Could not add the API key.")
  }
  if (!response.body.key) {
    throw new Error("Could not add the API key.")
  }
  return {
    key: response.body.key,
    workspace: response.body.workspace ?? null,
  }
}

async function fetchApiKeyNamespaces(
  apiKeyId: string,
): Promise<NamespaceView[]> {
  const body = await workspaceRouteClient.getJson<NamespacesResponse>(
    `/api/api-keys/${encodeURIComponent(apiKeyId)}/namespaces`,
  )
  return Array.isArray(body.namespaces) ? body.namespaces : []
}

async function activateWorkspace(workspaceId: string): Promise<void> {
  await workspaceRouteClient.postJson(
    "/api/workspaces/activate",
    { workspaceId },
  )
}

async function createWorkspace(
  keyId: string,
  namespace: string,
): Promise<WorkspaceView> {
  const response = await workspaceRouteClient.postJsonWithStatus<
    CreateWorkspaceResponse
  >("/api/workspaces", { keyId, namespace })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.body.message ?? "Could not create this workspace.")
  }
  if (!response.body.workspace) {
    throw new Error("Could not create this workspace.")
  }
  return response.body.workspace
}

async function setActiveWorkspaceApiKey(
  workspaceId: string,
  apiKeyId: string,
): Promise<void> {
  await workspaceRouteClient.patchJson(`/api/api-keys/${encodeURIComponent(apiKeyId)}`, {
    workspaceId,
  })
}

async function deleteUserApiKey(apiKeyId: string): Promise<void> {
  await workspaceRouteClient.deleteJson(
    `/api/api-keys/${encodeURIComponent(apiKeyId)}`,
    {},
  )
}

export type WorkspaceMemberView = {
  readonly userId: string
  readonly email: string | null
  readonly name: string | null
}

type WorkspaceMembersResponse = {
  members?: WorkspaceMemberView[]
  message?: string
}

async function fetchWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMemberView[]> {
  const body = await workspaceRouteClient.getJson<WorkspaceMembersResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
  )
  return Array.isArray(body.members) ? body.members : []
}

async function addWorkspaceMember(
  workspaceId: string,
  email: string,
): Promise<void> {
  const response = await workspaceRouteClient.postJsonWithStatus<
    WorkspaceMembersResponse
  >(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`, { email })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.body.message ?? "Could not add the member.")
  }
}

async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const response = await workspaceRouteClient.deleteJsonWithStatus<{
    message?: string
  }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
    {},
  )
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.body.message ?? "Could not remove the member.")
  }
}
