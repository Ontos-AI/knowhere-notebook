import { unstable_serialize } from "swr"
import type { Cache } from "swr"

import { workspaceClient } from "./client"
import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { SourceView } from "@/domains/sources/types"

type SourceChunksResponse = Awaited<
  ReturnType<typeof workspaceClient.fetchChunkPage>
>
type ChatThreadDetailResponse = Awaited<
  ReturnType<typeof workspaceClient.fetchChatThread>
>
type SourceChunksKey = readonly ["source-chunks", string, number]
type ChatThreadKey = readonly ["chat-thread", string]

type LoadedChatThreadDetail = ChatThreadDetailResponse & {
  readonly thread: ChatThreadView
  readonly messages: ChatMessageView[]
}

type WorkspaceClientCache = {
  readonly getCachedChatThreadData: (
    cache: Cache<unknown>,
    threadId: string,
  ) => ChatThreadDetailResponse | null
  readonly getChatThreadKey: (threadId: string) => ChatThreadKey
  readonly getSourceChunksKey: (
    sourceId: string | null,
    pageIndex: number,
    previousPageData: SourceChunksResponse | null,
  ) => SourceChunksKey | null
  readonly hasLoadedChatThreadData: (
    value: ChatThreadDetailResponse | null | undefined,
  ) => value is LoadedChatThreadDetail
  readonly hasMoreChunkPages: (
    pages: readonly SourceChunksResponse[] | undefined,
  ) => boolean
  readonly hasPendingSources: (sources: readonly SourceView[]) => boolean
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

function hasMoreChunkPages(
  pages: readonly SourceChunksResponse[] | undefined,
): boolean {
  const lastPage = pages?.at(-1)
  return lastPage ? hasMoreChunkPage(lastPage) : false
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

function hasLoadedChatThreadData(
  value: ChatThreadDetailResponse | null | undefined,
): value is LoadedChatThreadDetail {
  return Boolean(value?.thread && Array.isArray(value.messages))
}

function hasPendingSources(sources: readonly SourceView[]): boolean {
  return sources.some(
    (source) => source.status === "uploading" || source.status === "parsing",
  )
}

function hasMoreChunkPage(page: SourceChunksResponse): boolean {
  if (!page.pagination) return false
  return page.pagination.page < page.pagination.totalPages
}

function isChatThreadDetailResponse(
  value: unknown,
  threadId: string,
): value is ChatThreadDetailResponse {
  if (!value || typeof value !== "object") return false

  const response = value as Partial<ChatThreadDetailResponse>
  return response.requestedThreadId === threadId
}

export const workspaceClientCache: WorkspaceClientCache = {
  getCachedChatThreadData,
  getChatThreadKey,
  getSourceChunksKey,
  hasLoadedChatThreadData,
  hasMoreChunkPages,
  hasPendingSources,
}

export type {
  ChatThreadDetailResponse,
  ChatThreadKey,
  SourceChunksKey,
  SourceChunksResponse,
}
