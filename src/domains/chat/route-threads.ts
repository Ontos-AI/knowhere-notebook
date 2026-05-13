import { Effect } from "effect"

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

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const listThreadsEffect = Effect.gen(function* () {
  const { workspace } = yield* Effect.tryPromise(() =>
    notebookRequestContext.getAuthenticated(),
  )
  const threads = yield* Effect.tryPromise(() =>
    chatThreadService.listForWorkspace(workspace.id),
  )

  return routeResult.ok({
    threads: threads.map(toChatThreadView),
  })
})

const createThreadEffect = Effect.gen(function* () {
  const { workspace } = yield* Effect.tryPromise(() =>
    notebookRequestContext.getAuthenticated(),
  )
  const thread = yield* Effect.tryPromise(() =>
    chatThreadService.create(workspace.id),
  )

  return routeResult.ok({
    thread: toChatThreadView(thread),
    messages: [] as unknown as [],
  })
})

const getThreadEffect = (input: ThreadInput) =>
  Effect.gen(function* () {
    const { workspace } = yield* Effect.tryPromise(() =>
      notebookRequestContext.getAuthenticated(),
    )
    const thread = yield* Effect.tryPromise(() =>
      chatThreadService.findInWorkspace(workspace.id, input.threadId),
    )

    if (!thread) {
      return routeResult.error(404, "Chat thread not found.")
    }

    const messages = yield* Effect.tryPromise(() =>
      chatThreadService.listMessages(workspace.id, input.threadId),
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
  })

const archiveThreadEffect = (input: ArchiveThreadInput) =>
  Effect.gen(function* () {
    const { workspace } = yield* Effect.tryPromise(() =>
      notebookRequestContext.getAuthenticated(),
    )
    const archived = yield* Effect.tryPromise(() =>
      chatThreadService.softDelete(workspace.id, input.threadId),
    )
    if (!archived) {
      return routeResult.error(404, "Chat thread not found.")
    }

    return routeResult.ok({ id: input.threadId, archived: true as const })
  })

// ---------------------------------------------------------------------------
// Async wrappers (backward-compatible)
// ---------------------------------------------------------------------------

async function listThreads(): Promise<RouteResponse<ListThreadsBody>> {
  return Effect.runPromise(listThreadsEffect)
}

async function createThread(): Promise<RouteResponse<CreateThreadBody>> {
  return Effect.runPromise(createThreadEffect)
}

async function getThread(
  input: ThreadInput,
): Promise<RouteResponse<GetThreadBody | MessageBody>> {
  return Effect.runPromise(getThreadEffect(input))
}

async function archiveThread(
  input: ArchiveThreadInput,
): Promise<RouteResponse<ArchiveThreadBody | MessageBody>> {
  return Effect.runPromise(archiveThreadEffect(input))
}

export const chatThreadRouteService: ChatThreadRouteService = {
  archiveThread,
  createThread,
  getThread,
  listThreads,
}
