import type { ChatDiagramSpec } from "@/domains/chat/diagram"
import type {
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type {
  SourceView,
} from "@/domains/sources/types"
import { workspaceRouteClient } from "./route-client"

const workspaceClientKeys = {
  sources: "/api/sources",
  chatThreads: "/api/chat/threads",
  chatDiagram: "/api/chat/diagram",
  chat: "/api/chat",
  materializeDemoSources: "/api/demo-sources/materialize",
  archiveSource: "archive-source",
  retrySource: "retry-source",
  archiveChatThread: "archive-chat-thread",
} as const

const workspaceClientConfig = {
  sourceChunkPageSize: 50,
} as const

export type FetchChunksOptions = {
  readonly chunkType?: "text" | "image" | "table" | "page"
  readonly untilPageNumber?: number
}

type SourceChunksResponse = {
  chunks?: ParsedChunkView[]
  isProcessing?: boolean
  isUnavailable?: boolean
  message?: string
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
  useAgentic: boolean
  excludedSourceIds: string[]
}

type MaterializeDemoSourcesRequest = {
  demoSourceIds: string[]
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
  materializeDemoSources,
  archiveSource,
  retrySource,
  archiveChatThread,
} as const

async function fetchChunks(
  sourceId: string,
  options?: FetchChunksOptions,
): Promise<ParsedChunkView[]> {
  if (options?.untilPageNumber != null) {
    const { chunks } = await fetchChunkPagesUntil(sourceId, options)
    return chunks
  }

  try {
    const searchParams = new URLSearchParams()
    if (options?.chunkType) searchParams.set("chunkType", options.chunkType)
    const query = searchParams.toString()
    const body = await workspaceRouteClient.getJson<{
      chunks?: ParsedChunkView[]
    }>(
      `/api/sources/${encodeURIComponent(sourceId)}/chunks${query ? `?${query}` : ""}`,
    )
    return Array.isArray(body.chunks) ? body.chunks : []
  } catch {
    return []
  }
}

async function fetchChunkPage(
  sourceId: string,
  page: number,
  options?: Pick<FetchChunksOptions, "chunkType">,
): Promise<SourceChunksResponse> {
  const searchParams = new URLSearchParams({
    page: String(page),
    pageSize: String(workspaceClientConfig.sourceChunkPageSize),
  })
  if (options?.chunkType) searchParams.set("chunkType", options.chunkType)
  const body = await workspaceRouteClient.getJson<SourceChunksResponse>(
    `/api/sources/${encodeURIComponent(sourceId)}/chunks?${searchParams.toString()}`,
  )

  return {
    chunks: Array.isArray(body.chunks) ? body.chunks : [],
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    ...(body.isUnavailable === true ? { isUnavailable: true } : {}),
    ...(typeof body.message === "string" && body.isUnavailable !== true
      ? { isProcessing: true }
      : {}),
    pagination: body.pagination,
  }
}

async function fetchChunkPagesUntil(
  sourceId: string,
  options: FetchChunksOptions,
): Promise<{
  readonly chunks: ParsedChunkView[]
  readonly pages: SourceChunksResponse[]
}> {
  const pages: SourceChunksResponse[] = []
  const chunks: ParsedChunkView[] = []
  let page = 1
  let totalPages = 1

  do {
    const result = await fetchChunkPage(sourceId, page, {
      chunkType: options.chunkType,
    })
    pages.push(result)
    chunks.push(...(result.chunks ?? []))
    if (
      options.untilPageNumber != null &&
      chunksContainPage(chunks, options.untilPageNumber)
    ) {
      return { chunks, pages }
    }
    totalPages = result.pagination?.totalPages ?? 1
    page += 1
  } while (page <= totalPages)

  return { chunks, pages }
}

function chunksContainPage(
  chunks: readonly ParsedChunkView[],
  pageNumber: number,
): boolean {
  return chunks.some(
    (chunk) =>
      (chunk.pageAssets ?? []).some(
        (pageAsset) => pageAsset.pageNumber === pageNumber,
      ) || (chunk.pageNums ?? []).includes(pageNumber),
  )
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

async function materializeDemoSources(
  input: MaterializeDemoSourcesRequest,
): Promise<SourceView[]> {
  const response = await workspaceRouteClient.postJsonWithStatus<
    SourcesResponse & { readonly message?: string }
  >(
    workspaceClientKeys.materializeDemoSources,
    input,
  )
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      response.body.message ?? "Demo sources could not be prepared right now.",
    )
  }
  const body = response.body
  return Array.isArray(body.sources) ? body.sources : []
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
