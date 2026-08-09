import { Cause, Effect, Either, Option } from "effect"

import {
  generateAgenticOutputManifest,
  parseChatRequestBody,
} from "@/domains/chat"
import { hardenChatMediaAssetUrls } from "@/domains/chat/media-asset-hardening"
import {
  handleChatTurn,
  type ChatTurnError,
  type ChatTurnValue,
} from "@/domains/chat/service"
import { chatTurnPersistence } from "@/domains/chat/chat-turn-persistence"
import { startBackgroundReconciliation } from "@/domains/sources/background-reconcile"
import { sourceService } from "@/domains/sources/service"
import { sourceWorkflowRuntime } from "@/domains/sources/workflow-runtime"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import type { Source } from "@/infrastructure/db/schema"
import { isAuthError } from "@/integrations/knowhere-credentials"
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

    const { workspace, client, apiKey } = yield* Effect.tryPromise(() =>
      notebookRequestContext.getAuthenticatedWithClient(),
    )
    const sources = yield* Effect.tryPromise(() =>
      sourceWorkflowRuntime.listForWorkspace(workspace.id),
    )
    yield* Effect.sync(() =>
      triggerBackgroundReconciliationForParsingSources({
        workspaceId: workspace.id,
        sources,
        apiKey,
      }),
    )
    const loadSourceAssetUrls = (source: (typeof sources)[number]) =>
      sourceService.getParseAssetUrls(workspace.id, source.id)

    const result: Either.Either<ChatTurnValue, ChatAnswerFailure> =
      yield* Effect.tryPromise(() =>
        handleChatTurn({
          workspace,
          sources,
          question: body.value.question,
          threadId: body.value.threadId,
          excludedSourceIds: body.value.excludedSourceIds,
          retrievalParams: body.value.retrievalParams,
          retrieval: client.retrieval,
          generateAnswer: generateAgenticOutputManifest,
          loadSourceAssetUrls,
          hardenMediaAssetUrls: ({ results, artifacts }) =>
            hardenChatMediaAssetUrls({
              workspaceId: workspace.id,
              sources,
              results,
              artifacts,
              loadSourceAssetUrls,
            }),
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

function triggerBackgroundReconciliationForParsingSources(input: {
  readonly workspaceId: string
  readonly sources: readonly Source[]
  readonly apiKey: string
}): void {
  const parsingSources = input.sources.filter(
    (source) => source.status === "parsing" && source.knowhereJobId,
  )
  if (parsingSources.length === 0) return

  logger.info("chat: re-triggering reconciliation for parsing sources", {
    workspaceId: input.workspaceId,
    count: parsingSources.length,
    sourceIds: parsingSources.map((source) => source.id),
  })

  for (const source of parsingSources) {
    void startBackgroundReconciliation(
      input.workspaceId,
      source.id,
      input.apiKey,
    ).catch((error: unknown) => {
      logger.warn("chat: background reconciliation trigger failed", {
        workspaceId: input.workspaceId,
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
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
