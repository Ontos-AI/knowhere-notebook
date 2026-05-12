import { Either } from "effect"

import {
  generateContextualRetrievalQuery,
  generateGroundedAnswer,
  parseChatRequestBody,
} from "@/domains/chat"
import {
  handleChatTurn,
  type ChatTurnValue,
} from "@/domains/chat/service"
import { chatTurnPersistence } from "@/domains/chat/chat-turn-persistence"
import { reconcileSourcesForWorkspace } from "@/domains/sources/reconcile"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import { routeResult, type RouteResult } from "@/lib/route-result"

type RouteResponse<TBody> = RouteResult<TBody>

type MessageBody = {
  readonly message: string
}

type AnswerChatInput = {
  readonly body: unknown
}

type ChatAnswerRouteService = {
  readonly answerChat: (
    input: AnswerChatInput,
  ) => Promise<RouteResponse<ChatTurnValue | MessageBody>>
}

async function answerChat(
  input: AnswerChatInput,
): Promise<RouteResponse<ChatTurnValue | MessageBody>> {
  const body = parseChatRequestBody(input.body)
  if (!body.ok) {
    return routeResult.error(body.status, body.message)
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
      repository: chatTurnPersistence.createRepository(),
    })

    return Either.match(result, {
      onLeft: (error): RouteResponse<MessageBody> =>
        routeResult.error(error.status, error.message),
      onRight: (value): RouteResponse<ChatTurnValue> => routeResult.ok(value),
    })
  } catch {
    return routeResult.error(
      401,
      "Your session may have expired. Please refresh the page.",
    )
  }
}

export const chatAnswerRouteService: ChatAnswerRouteService = {
  answerChat,
}
