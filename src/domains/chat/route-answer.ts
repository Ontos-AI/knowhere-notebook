import { Cause, Effect, Either, Option } from "effect"

import {
  generateAgenticOutputManifest,
  parseChatRequestBody,
} from "@/domains/chat"
import {
  handleChatTurn,
  type ChatTurnError,
  type ChatTurnValue,
} from "@/domains/chat/service"
import { chatTurnPersistence } from "@/domains/chat/chat-turn-persistence"
import { reconcileSourcesForWorkspace } from "@/domains/sources/reconcile"
import { sourceService } from "@/domains/sources/service"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import { isAuthError } from "@/integrations/dashboard/api-key-service"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"
import { routeResult, type RouteResult } from "@/lib/route-result"

type RouteResponse<TBody> = RouteResult<TBody>

type MessageBody = {
  readonly message: string
}

type ChatRouteFailure = {
  readonly status: 401 | 502
  readonly message: string
}

type ChatAnswerFailure = ChatTurnError | ChatRouteFailure

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

    const result: Either.Either<ChatTurnValue, ChatAnswerFailure> =
      yield* Effect.tryPromise(() =>
        handleChatTurn({
          workspace,
          sources,
          question: body.value.question,
          threadId: body.value.threadId,
          excludedSourceIds: body.value.excludedSourceIds,
          retrieval: client.retrieval,
          generateAnswer: generateAgenticOutputManifest,
          loadSourceAssetUrls: (source) =>
            sourceService.getParseAssetUrls(workspace.id, source.id),
          repository: chatTurnPersistence.createRepository(),
        }),
      ).pipe(
        Effect.catchAllCause(
          (
            cause,
          ): Effect.Effect<
            Either.Either<ChatTurnValue, ChatAnswerFailure>
          > =>
            Effect.gen(function* () {
              const detail = getCauseSummary(cause)
              const prettyCause = Cause.pretty(cause).slice(0, 2_000)
              const failure = toChatRouteFailure(detail)
              yield* Effect.logError("chat: answer failed").pipe(
                Effect.annotateLogs({
                  status: failure.status,
                  detail,
                  cause: prettyCause,
                }),
              )
              yield* Effect.sync(() =>
                logger.error("chat: answer failed", {
                  status: failure.status,
                  detail,
                  cause: prettyCause,
                }),
              )

              return Either.left(failure)
            }),
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

function toChatRouteFailure(detail: string): ChatRouteFailure {
  const routeDetail = getSafeRouteDetail(detail)
  if (isAuthError({ message: routeDetail })) {
    return {
      status: 401,
      message: `Chat authentication failed: ${routeDetail}`,
    }
  }

  return {
    status: 502,
    message: `Chat generation failed: ${routeDetail}`,
  }
}

function getCauseSummary(cause: Cause.Cause<unknown>): string {
  const failure = Cause.failureOption(cause)
  const failureSummary = Option.isSome(failure)
    ? summarizeUnknownError(failure.value)
    : null
  if (failureSummary && isMeaningfulSummary(failureSummary)) {
    return failureSummary
  }

  for (const defect of Cause.defects(cause)) {
    const defectSummary = summarizeUnknownError(defect)
    if (isMeaningfulSummary(defectSummary)) return defectSummary
  }

  const squashedSummary = summarizeUnknownError(Cause.squash(cause))
  if (isMeaningfulSummary(squashedSummary)) return squashedSummary

  return Cause.pretty(cause)
}

function getSafeRouteDetail(detail: string): string {
  const normalized = detail.replace(/\s+/g, " ").trim()
  if (normalized.length === 0) return "Unexpected chat generation failure."
  return normalized.slice(0, 800)
}

function isMeaningfulSummary(value: string): boolean {
  const normalized = value.trim()
  return (
    normalized.length > 0 &&
    normalized !== "An unknown error occurred in Effect.tryPromise"
  )
}
