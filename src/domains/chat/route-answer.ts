import { Effect, Either } from "effect"

import {
  generateAgenticGroundedAnswer,
  parseChatRequestBody,
} from "@/domains/chat"
import {
  handleChatTurn,
  type ChatTurnValue,
} from "@/domains/chat/service"
import { chatTurnPersistence } from "@/domains/chat/chat-turn-persistence"
import { reconcileSourcesForWorkspace } from "@/domains/sources/reconcile"
import { sourceService } from "@/domains/sources/service"
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

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const answerChatEffect = (input: AnswerChatInput) =>
  Effect.gen(function* () {
    const body = parseChatRequestBody(input.body)
    if (!body.ok) {
      return routeResult.error(body.status, body.message)
    }

    const { workspace, client } = yield* Effect.tryPromise(() =>
      notebookRequestContext.getAuthenticatedWithClient(),
    )
    const sources = yield* Effect.tryPromise(() =>
      reconcileSourcesForWorkspace(workspace, client),
    )

    const result = yield* Effect.tryPromise(() =>
      handleChatTurn({
        workspace,
        sources,
        question: body.value.question,
        threadId: body.value.threadId,
        excludedSourceIds: body.value.excludedSourceIds,
        retrieval: client.retrieval,
        generateAnswer: generateAgenticGroundedAnswer,
        loadSourceAssetUrls: (source) =>
          sourceService.getParseAssetUrls(workspace.id, source.id),
        repository: chatTurnPersistence.createRepository(),
      }),
    ).pipe(
      Effect.catchAll(() =>
        Effect.succeed(
          Either.left({
            status: 401,
            message: "Your session may have expired. Please refresh the page.",
          }),
        ),
      ),
    )

    return Either.match(result, {
      onLeft: (error): RouteResponse<MessageBody> =>
        routeResult.error(error.status, error.message),
      onRight: (value): RouteResponse<ChatTurnValue> => routeResult.ok(value),
    })
  })

// ---------------------------------------------------------------------------
// Async wrapper (backward-compatible)
// ---------------------------------------------------------------------------

async function answerChat(
  input: AnswerChatInput,
): Promise<RouteResponse<ChatTurnValue | MessageBody>> {
  return Effect.runPromise(answerChatEffect(input))
}

export const chatAnswerRouteService: ChatAnswerRouteService = {
  answerChat,
}
