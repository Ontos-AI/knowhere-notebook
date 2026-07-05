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
import { BlobParsedDocumentStorage } from "@/domains/sources/parsed-document-blob-storage"
import { sourceWorkflowRuntime } from "@/domains/sources/workflow-runtime"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import type { Source } from "@/infrastructure/db/schema"
import type { HardenChatAssetUrl } from "./media-assets"
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
    const parsedStorage = new BlobParsedDocumentStorage({
      workspaceId: workspace.id,
    })
    const hardenChatAssetUrl: HardenChatAssetUrl = async ({
      source,
      sourcePath,
      assetUrl,
      contentType,
    }): Promise<string | null> =>
      hardenSingleChatAsset({
        workspaceId: workspace.id,
        parsedStorage,
        source,
        sourcePath,
        assetUrl,
        contentType,
      })

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
          hardenChatAssetUrl,
          hardenMediaAssetUrls: ({ results, artifacts }) =>
            hardenChatMediaAssetUrls({
              workspaceId: workspace.id,
              sources,
              results,
              artifacts,
              hardenChatAssetUrl,
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

async function hardenSingleChatAsset(input: {
  readonly workspaceId: string
  readonly parsedStorage: BlobParsedDocumentStorage
  readonly source: Source
  readonly sourcePath: string
  readonly assetUrl?: string | null
  readonly contentType?: string | null
}): Promise<string | null> {
  if (
    input.source.status !== "ready" ||
    !input.source.knowhereDocumentId ||
    !input.source.knowhereJobId
  ) {
    return null
  }

  try {
    const existingUrl = await input.parsedStorage.getAssetUrl({
      documentId: input.source.knowhereDocumentId,
      revisionKey: input.source.knowhereJobId,
      sourcePath: input.sourcePath,
    })
    if (existingUrl) return existingUrl

    const sourceUrl = getTrimmedString(input.assetUrl)
    if (!sourceUrl) return null

    const fetchedAsset = await fetchChatAsset({
      assetUrl: sourceUrl,
      fallbackContentType:
        getTrimmedString(input.contentType) ??
        inferContentTypeFromPath(input.sourcePath),
    })
    const writtenAsset = await input.parsedStorage.writeAsset({
      documentId: input.source.knowhereDocumentId,
      revisionKey: input.source.knowhereJobId,
      sourcePath: input.sourcePath,
      body: fetchedAsset.body,
      contentType: fetchedAsset.contentType,
    })

    return (
      writtenAsset.url ??
      (await input.parsedStorage.getAssetUrl({
        documentId: input.source.knowhereDocumentId,
        revisionKey: input.source.knowhereJobId,
        sourcePath: input.sourcePath,
      }))
    )
  } catch (error) {
    logger.warn("chat: single parsed asset hardening failed", {
      workspaceId: input.workspaceId,
      sourceId: input.source.id,
      documentId: input.source.knowhereDocumentId,
      sourcePath: input.sourcePath,
      error: summarizeUnknownError(error),
    })
    return null
  }
}

async function fetchChatAsset(input: {
  readonly assetUrl: string
  readonly fallbackContentType: string
}): Promise<{
  readonly body: Uint8Array
  readonly contentType: string
}> {
  const response = await fetch(input.assetUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch chat asset (${response.status} ${response.statusText})`,
    )
  }

  return {
    body: new Uint8Array(await response.arrayBuffer()),
    contentType:
      getTrimmedString(response.headers.get("content-type")) ??
      input.fallbackContentType,
  }
}

function inferContentTypeFromPath(sourcePath: string): string {
  const pathname = sourcePath.toLowerCase().split("?")[0] ?? sourcePath
  if (pathname.endsWith(".png")) return "image/png"
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg"
  }
  if (pathname.endsWith(".gif")) return "image/gif"
  if (pathname.endsWith(".webp")) return "image/webp"
  if (pathname.endsWith(".svg")) return "image/svg+xml"
  if (pathname.endsWith(".html") || pathname.endsWith(".htm")) {
    return "text/html; charset=utf-8"
  }
  return "application/octet-stream"
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

function getTrimmedString(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() ?? ""
  return trimmedValue.length > 0 ? trimmedValue : null
}
