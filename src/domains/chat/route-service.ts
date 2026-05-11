import { Either, Schema } from "effect"

import {
  generateContextualRetrievalQuery,
  generateGroundedAnswer,
  parseChatRequestBody,
} from "@/domains/chat"
import {
  handleChatTurn,
  type ChatTurnValue,
} from "@/domains/chat/service"
import { chatThreadService } from "@/domains/chat/thread-service"
import { toChatMessageView, toChatThreadView } from "@/domains/chat/view"
import { reconcileSourcesForWorkspace } from "@/domains/sources/reconcile"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import type { ChatMessageView, ChatThreadView } from "@/domains/chat/types"

type RouteStatus = 200 | 400 | 401 | 404 | 409

type RouteResponse<TBody> = {
  readonly status: RouteStatus
  readonly body: TBody
}

type MessageBody = {
  readonly message: string
}

type AnswerChatInput = {
  readonly body: unknown
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

type ArchiveThreadInput = {
  readonly threadId: string
  readonly body: unknown
}

type ArchiveThreadBody = {
  readonly id: string
  readonly archived: true
}

type ChatRepositoryMessages = Awaited<ReturnType<typeof chatThreadService.listMessages>>
type ChatRepositoryMessage = NonNullable<ChatRepositoryMessages>[number]

const ArchiveRequest = Schema.Struct({
  archived: Schema.Literal(true),
})

async function answerChat(
  input: AnswerChatInput,
): Promise<RouteResponse<ChatTurnValue | MessageBody>> {
  const body = parseChatRequestBody(input.body)
  if (!body.ok) {
    return createErrorResponse(body.status, body.message)
  }

  const { workspace, client } =
    await notebookRequestContext.getAuthenticatedWithClient()
  const sources = await reconcileSourcesForWorkspace(workspace, client)

  try {
    const result = await handleChatTurn({
      workspace,
      sources,
      question: body.value.question,
      threadId: body.value.threadId,
      excludedSourceIds: body.value.excludedSourceIds,
      retrieval: client.retrieval,
      generateRetrievalQuery: generateContextualRetrievalQuery,
      generateAnswer: generateGroundedAnswer,
      repository: {
        ensureDefaultChatThread: chatThreadService.ensureDefault,
        findChatThreadInWorkspace: chatThreadService.findInWorkspace,
        listMessagesForThread: listMutableMessagesForThread,
        appendMessageToThread: chatThreadService.appendMessage,
      },
    })

    return Either.match(result, {
      onLeft: (error): RouteResponse<MessageBody> =>
        createErrorResponse(error.status, error.message),
      onRight: (value): RouteResponse<ChatTurnValue> => createOkResponse(value),
    })
  } catch {
    return createErrorResponse(
      401,
      "Your session may have expired. Please refresh the page.",
    )
  }
}

async function listThreads(): Promise<RouteResponse<ListThreadsBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const threads = await chatThreadService.listForWorkspace(workspace.id)

  return createOkResponse({
    threads: threads.map(toChatThreadView),
  })
}

async function createThread(): Promise<RouteResponse<CreateThreadBody>> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const thread = await chatThreadService.create(workspace.id)

  return createOkResponse({
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
    return createErrorResponse(404, "Chat thread not found.")
  }

  const messages = await chatThreadService.listMessages(
    workspace.id,
    input.threadId,
  )
  if (!messages) {
    return createErrorResponse(404, "Chat thread not found.")
  }

  return createOkResponse({
    thread: toChatThreadView(thread),
    messages: messages.map((message): ChatMessageView =>
      toChatMessageView(message),
    ),
  })
}

async function archiveThread(
  input: ArchiveThreadInput,
): Promise<RouteResponse<ArchiveThreadBody | MessageBody>> {
  if (Either.isLeft(Schema.decodeUnknownEither(ArchiveRequest)(input.body))) {
    return createErrorResponse(
      400,
      "Request body must include `archived: true`.",
    )
  }

  const { workspace } = await notebookRequestContext.getAuthenticated()
  const archived = await chatThreadService.softDelete(
    workspace.id,
    input.threadId,
  )
  if (!archived) {
    return createErrorResponse(404, "Chat thread not found.")
  }

  return createOkResponse({ id: input.threadId, archived: true })
}

async function listMutableMessagesForThread(
  workspaceId: string,
  threadId: string,
): Promise<ChatRepositoryMessage[] | null> {
  const messages = await chatThreadService.listMessages(workspaceId, threadId)
  if (!messages) return null

  return [...messages]
}

function createOkResponse<TBody>(body: TBody): RouteResponse<TBody> {
  return { status: 200, body }
}

function createErrorResponse(
  status: Exclude<RouteStatus, 200>,
  message: string,
): RouteResponse<MessageBody> {
  return {
    status,
    body: { message },
  }
}

export const chatRouteService = {
  answerChat,
  listThreads,
  createThread,
  getThread,
  archiveThread,
}
