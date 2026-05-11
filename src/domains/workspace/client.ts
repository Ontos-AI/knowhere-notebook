import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { Effect } from "effect"

import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"

const workspaceClientKeys = {
  sources: "/api/sources",
  chatThreads: "/api/chat/threads",
  chat: "/api/chat",
  archiveSource: "archive-source",
  archiveChatThread: "archive-chat-thread",
} as const

const workspaceClientConfig = {
  sourceChunkPageSize: 100,
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

type ArchiveResponse = {
  id?: string
  archived?: boolean
}

export const workspaceClient = {
  keys: workspaceClientKeys,
  fetchChunks,
  fetchChunkPage,
  fetchSources,
  fetchChatThreads,
  fetchChatThread,
  createChatThread,
  sendChatMessage,
  archiveSource,
  archiveChatThread,
} as const

async function fetchChunks(sourceId: string): Promise<ParsedChunkView[]> {
  try {
    const body = await getJson<{ chunks?: ParsedChunkView[] }>(
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
  const body = await getJson<SourceChunksResponse>(
    `/api/sources/${encodeURIComponent(sourceId)}/chunks?${searchParams.toString()}`,
  )

  return {
    chunks: Array.isArray(body.chunks) ? body.chunks : [],
    pagination: body.pagination,
  }
}

async function fetchSources(): Promise<SourceView[]> {
  const body = await getJson<SourcesResponse>(workspaceClientKeys.sources)
  return Array.isArray(body.sources) ? body.sources : []
}

async function fetchChatThreads(): Promise<ChatThreadView[]> {
  const body = await getJson<ChatThreadsResponse>(
    workspaceClientKeys.chatThreads,
  )
  return Array.isArray(body.threads) ? body.threads : []
}

async function fetchChatThread(
  threadId: string,
): Promise<ChatThreadDetailResponse> {
  const body = await getJson<ChatThreadResponse>(
    `/api/chat/threads/${encodeURIComponent(threadId)}`,
  )
  return { ...body, requestedThreadId: threadId }
}

function createChatThread(): Promise<ChatThreadResponse> {
  return postJson<ChatThreadResponse>(workspaceClientKeys.chatThreads, {})
}

function sendChatMessage(
  input: ChatMessageRequest,
): Promise<ChatMessageResponse> {
  return postJson<ChatMessageResponse>(workspaceClientKeys.chat, input)
}

function archiveSource(sourceId: string): Promise<ArchiveResponse> {
  return patchJson(`/api/sources/${encodeURIComponent(sourceId)}`, {
    archived: true,
  })
}

function archiveChatThread(threadId: string): Promise<ArchiveResponse> {
  return patchJson(`/api/chat/threads/${encodeURIComponent(threadId)}`, {
    archived: true,
  })
}

const getJson = <T,>(url: string): Promise<T> =>
  Effect.runPromise(
    Effect.flatMap(
      HttpClientRequest.get(resolveSameOriginUrl(url)).pipe(HttpClient.execute),
      (response) => response.json,
    ).pipe(Effect.provide(FetchHttpClient.layer)) as Effect.Effect<T>,
  )

const postJson = <T,>(url: string, body: unknown): Promise<T> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.post(
        resolveSameOriginUrl(url),
      ).pipe(HttpClientRequest.bodyJson(body))
      const response = yield* HttpClient.execute(request)
      return yield* response.json
    }).pipe(Effect.provide(FetchHttpClient.layer)) as Effect.Effect<T>,
  )

const patchJson = <T,>(url: string, body: unknown): Promise<T> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.patch(
        resolveSameOriginUrl(url),
      ).pipe(HttpClientRequest.bodyJson(body))
      const response = yield* HttpClient.execute(request)
      return yield* response.json
    }).pipe(Effect.provide(FetchHttpClient.layer)) as Effect.Effect<T>,
  )

function resolveSameOriginUrl(path: string): string {
  const origin = globalThis.location?.origin
  return new URL(path, origin ?? "http://localhost").toString()
}
