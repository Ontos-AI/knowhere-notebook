import { chatThreadService } from "@/domains/chat/thread-service"
import { toChatMessageView, toChatThreadView } from "@/domains/chat/view"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import type { ChatMessageView, ChatThreadView } from "@/domains/chat/types"
import { routeResult, type RouteResult } from "@/lib/route-result"

type RouteResponse<TBody> = RouteResult<TBody>

type MessageBody = {
  readonly message: string
}

type ListThreadsBody = {
  readonly threads: ChatThreadView[]
}

type CreateThreadBody = {
  readonly thread: ChatThreadView
  readonly messages: []
}

type ThreadInput = {
  readonly threadId: string
}

type GetThreadBody = {
  readonly thread: ChatThreadView
  readonly messages: ChatMessageView[]
}

export type ArchiveThreadInput = {
  readonly threadId: string
}

type ArchiveThreadBody = {
  readonly id: string
  readonly archived: true
}

type ChatThreadRouteService = {
  readonly archiveThread: (
    input: ArchiveThreadInput,
  ) => Promise<RouteResponse<ArchiveThreadBody | MessageBody>>
  readonly createThread: () => Promise<RouteResponse<CreateThreadBody>>
  readonly getThread: (
    input: ThreadInput,
  ) => Promise<RouteResponse<GetThreadBody | MessageBody>>
  readonly listThreads: () => Promise<RouteResponse<ListThreadsBody>>
}

async function listThreads(): Promise<RouteResponse<ListThreadsBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const threads = await chatThreadService.listForWorkspace(workspace.id)

  return routeResult.ok({
    threads: threads.map(toChatThreadView),
  })
}

async function createThread(): Promise<RouteResponse<CreateThreadBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const thread = await chatThreadService.create(workspace.id)

  return routeResult.ok({
    thread: toChatThreadView(thread),
    messages: [],
  })
}

async function getThread(
  input: ThreadInput,
): Promise<RouteResponse<GetThreadBody | MessageBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const thread = await chatThreadService.findInWorkspace(
    workspace.id,
    input.threadId,
  )

  if (!thread) {
    return routeResult.error(404, "Chat thread not found.")
  }

  const messages = await chatThreadService.listMessages(
    workspace.id,
    input.threadId,
  )
  if (!messages) {
    return routeResult.error(404, "Chat thread not found.")
  }

  return routeResult.ok({
    thread: toChatThreadView(thread),
    messages: messages.map((message): ChatMessageView =>
      toChatMessageView(message),
    ),
  })
}

async function archiveThread(
  input: ArchiveThreadInput,
): Promise<RouteResponse<ArchiveThreadBody | MessageBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const archived = await chatThreadService.softDelete(
    workspace.id,
    input.threadId,
  )
  if (!archived) {
    return routeResult.error(404, "Chat thread not found.")
  }

  return routeResult.ok({ id: input.threadId, archived: true })
}

export const chatThreadRouteService: ChatThreadRouteService = {
  archiveThread,
  createThread,
  getThread,
  listThreads,
}
