import { unstable_serialize } from "swr"
import type { Cache } from "swr"

import { workspaceClient } from "@/domains/workspace/client"
import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"

export type SourceChunksKey = readonly ["source-chunks", string, number]
export type ChatThreadKey = readonly ["chat-thread", string]
export type SourceChunksResponse = Awaited<
  ReturnType<typeof workspaceClient.fetchChunkPage>
>
export type ChatThreadDetailResponse = Awaited<
  ReturnType<typeof workspaceClient.fetchChatThread>
>
export type ChatMessageRequest = Parameters<
  typeof workspaceClient.sendChatMessage
>[0]

type LoadedChatThreadDetail = ChatThreadDetailResponse & {
  readonly thread: ChatThreadView
  readonly messages: ChatMessageView[]
}

type WorkspaceShellClientModule = {
  readonly keys: typeof workspaceClient.keys
  readonly fetchSources: () => Promise<SourceView[]>
  readonly fetchChatThreads: () => Promise<ChatThreadView[]>
  readonly fetchChunks: (sourceId: string) => Promise<ParsedChunkView[]>
  readonly getSourceChunksKey: (
    sourceId: string | null,
    pageIndex: number,
    previousPageData: SourceChunksResponse | null,
  ) => SourceChunksKey | null
  readonly fetchChunksByKey: (
    key: SourceChunksKey,
  ) => Promise<SourceChunksResponse>
  readonly hasMoreChunkPages: (
    pages: readonly SourceChunksResponse[] | undefined,
  ) => boolean
  readonly getChatThreadKey: (threadId: string) => ChatThreadKey
  readonly getCachedChatThreadData: (
    cache: Cache<unknown>,
    threadId: string,
  ) => ChatThreadDetailResponse | null
  readonly hasLoadedChatThreadData: (
    value: ChatThreadDetailResponse | null | undefined,
  ) => value is LoadedChatThreadDetail
  readonly fetchChatThreadByKey: (
    key: ChatThreadKey,
  ) => Promise<ChatThreadDetailResponse>
  readonly createChatThreadMutation: () => ReturnType<
    typeof workspaceClient.createChatThread
  >
  readonly sendChatMessageMutation: (
    key: string,
    options: { readonly arg: ChatMessageRequest },
  ) => ReturnType<typeof workspaceClient.sendChatMessage>
  readonly archiveSourceMutation: (
    key: string,
    options: { readonly arg: string },
  ) => ReturnType<typeof workspaceClient.archiveSource>
  readonly archiveChatThreadMutation: (
    key: string,
    options: { readonly arg: string },
  ) => ReturnType<typeof workspaceClient.archiveChatThread>
  readonly hasPendingSources: (sources: readonly SourceView[]) => boolean
}

async function fetchChunks(sourceId: string): Promise<ParsedChunkView[]> {
  return workspaceClient.fetchChunks(sourceId)
}

function fetchSources(): Promise<SourceView[]> {
  return workspaceClient.fetchSources()
}

function fetchChatThreads(): Promise<ChatThreadView[]> {
  return workspaceClient.fetchChatThreads()
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
): value is LoadedChatThreadDetail {
  return Boolean(value?.thread && Array.isArray(value.messages))
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

function archiveSourceMutation(
  _key: string,
  { arg: sourceId }: { readonly arg: string },
): ReturnType<typeof workspaceClient.archiveSource> {
  return workspaceClient.archiveSource(sourceId)
}

function archiveChatThreadMutation(
  _key: string,
  { arg: threadId }: { readonly arg: string },
): ReturnType<typeof workspaceClient.archiveChatThread> {
  return workspaceClient.archiveChatThread(threadId)
}

function hasPendingSources(sources: readonly SourceView[]): boolean {
  return sources.some(
    (source) => source.status === "uploading" || source.status === "parsing",
  )
}

export const workspaceShellClient: WorkspaceShellClientModule = {
  keys: workspaceClient.keys,
  fetchSources,
  fetchChatThreads,
  fetchChunks,
  getSourceChunksKey,
  fetchChunksByKey,
  hasMoreChunkPages,
  getChatThreadKey,
  getCachedChatThreadData,
  hasLoadedChatThreadData,
  fetchChatThreadByKey,
  createChatThreadMutation,
  sendChatMessageMutation,
  archiveSourceMutation,
  archiveChatThreadMutation,
  hasPendingSources,
}
