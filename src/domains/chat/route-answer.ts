import { Cause, Effect, Either, Option, Runtime, Schema } from "effect"

import { parseChatRequestBody } from "@/domains/chat"
import { commitAgenticChatTurn } from "@/domains/chat/commit-turn"
import { hardenChatMediaAssetUrls } from "@/domains/chat/media-asset-hardening"
import {
  type ChatTurnError,
  type ChatTurnValue,
} from "@/domains/chat/service"
import { chatTurnPersistence } from "@/domains/chat/chat-turn-persistence"
import { createConnectedAssetResolver } from "@/domains/chat/connected-assets"
import { folderWorkflowRuntime } from "@/domains/folders/workflow-runtime"
import { startBackgroundReconciliation } from "@/domains/sources/background-reconcile"
import { BlobParsedDocumentStorage } from "@/domains/sources/parsed-document-blob-storage"
import { sourceWorkflowRuntime } from "@/domains/sources/workflow-runtime"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import type { Source } from "@/infrastructure/db/schema"
import { resolveCitationSources } from "./citation-sources"
import type { DemoCatalog } from "@/integrations/knowhere-demo"
import type { ChatSource, RetrievalPreparationFailure } from "./contracts"
import { sourceService } from "@/domains/sources/service"
import { resolveWorkspaceDemoSources } from "@/domains/demo/workspace-source-resolution"
import type { HardenChatAssetUrl } from "./media-assets"
import { isAuthError } from "@/integrations/dashboard/api-key-service"
import { makeKnowhereClientWithParsedStorage } from "@/integrations/knowhere"
import { knowhereDemoApi } from "@/integrations/knowhere-demo"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"
import { routeResult, type RouteResult } from "@/lib/route-result"

type RouteResponse<TBody> = RouteResult<TBody>

type MessageBody = {
  readonly message: string
}

type ChatRouteFailure = {
  readonly status: 401 | 409 | 429 | 502 | 503
  readonly message: string
}

class ChatDemoCatalogUnavailable extends Schema.TaggedError<ChatDemoCatalogUnavailable>()("ChatDemoCatalogUnavailable", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

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
    const listedSources = yield* Effect.tryPromise(() =>
      sourceWorkflowRuntime.listForWorkspace(workspace.id),
    )
    yield* Effect.sync(() =>
      triggerBackgroundReconciliationForParsingSources({
        workspaceId: workspace.id,
        sources: listedSources,
        apiKey,
      }),
    )
    const preparation = yield* Effect.all({
      catalog: Effect.either(Effect.tryPromise({ try: () => knowhereDemoApi.fetchCatalog(), catch: (cause: unknown) => new ChatDemoCatalogUnavailable({ message: summarizeUnknownError(cause), cause }) })),
      hiddenDemoSourceIds: Effect.tryPromise(() => sourceService.listHiddenDemoSourceIds(workspace.id)),
      selectedDemoSourceIds: Effect.tryPromise(() => sourceService.listSelectedDemoSourceIds(workspace.id)),
      legacyDemoDocumentIds: Effect.tryPromise(() => sourceService.listLegacyDemoDocumentIds(workspace.id)),
    }, { concurrency: 4 })
    const { hiddenDemoSourceIds, selectedDemoSourceIds, legacyDemoDocumentIds } = preparation
    const catalog: DemoCatalog = Either.isRight(preparation.catalog) ? preparation.catalog.right : { sources: [], officialLibrary: { categories: [], sources: [] } }
    const retrievalPreparationFailures: readonly RetrievalPreparationFailure[] = Either.isLeft(preparation.catalog)
      ? [{ warning: { scope: "demo", code: "demo_catalog_unavailable", message: "Demo sources are unavailable. The answer uses available workspace sources." }, cause: preparation.catalog.left }]
      : []
    if (Either.isLeft(preparation.catalog) && !listedSources.some((source) => !source.demoKey && source.status === "ready" && source.knowhereDocumentId)) {
      const failure = toChatRouteFailure(summarizeUnknownError(preparation.catalog.left), preparation.catalog.left)
      return routeResult.error(failure.status, failure.message)
    }
    const resolvedSources = resolveWorkspaceDemoSources(listedSources, catalog, new Set(hiddenDemoSourceIds), new Set(selectedDemoSourceIds))
    const sources: readonly ChatSource[] = [
      ...resolvedSources.workspaceSources,
      ...resolvedSources.demoSources.filter((source) => source.officialLibrary === undefined).map((source): ChatSource => ({
        id: source.id, title: source.title, mimeType: source.mimeType, status: source.status,
        knowhereDocumentId: source.documentId ?? null, knowhereJobId: null,
        demoKey: source.demoSourceId ?? source.id, namespace: "__knowhere_demo__",
        ...(source.jobResultId ? { jobResultId: source.jobResultId } : {}),
      })),
    ]
    const excludedWorkspaceDemoDocumentIds: readonly string[] = [...new Set([
      ...legacyDemoDocumentIds,
      ...listedSources.flatMap((source) => source.demoKey && source.knowhereDocumentId ? [source.knowhereDocumentId] : []),
    ])]
    const parsedStorage = new BlobParsedDocumentStorage({
      workspaceId: workspace.id,
    })
    const knowhereResources = makeKnowhereClientWithParsedStorage(apiKey, {
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
    const resolveConnectedAssets = createConnectedAssetResolver(
      knowhereResources.client.documents,
    )

    const result: Either.Either<ChatTurnValue, ChatAnswerFailure> =
      yield* Effect.tryPromise(() =>
        commitAgenticChatTurn({
          workspace,
          sources,
          excludedWorkspaceDemoDocumentIds,
          retrievalPreparationFailures,
          question: body.value.question,
          threadId: body.value.threadId,
          useAgentic: body.value.useAgentic,
          excludedSourceIds: body.value.excludedSourceIds,
          folderId: body.value.folderId,
          resolveFolderScopeSourceIds:
            folderWorkflowRuntime.resolveDescendantSourceIds,
          retrieval: client.retrieval,
          knowledge: knowhereResources.knowledge,
          hardenChatAssetUrl,
          hardenMediaAssetUrls: ({ results, artifacts }) =>
            hardenChatMediaAssetUrls({
              workspaceId: workspace.id,
              sources,
              results,
              artifacts,
              hardenChatAssetUrl,
            }),
          resolveConnectedAssets,
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
              const failure = toChatRouteFailure(detail, Cause.squash(cause))
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
      onRight: (value): RouteResponse<ChatTurnValue> =>
        routeResult.ok({ ...value, citationSources: resolveCitationSources({
          messages: value.messages, sources: listedSources, catalog, namespace: workspace.namespace,
        }) }),
    })
  })

// ---------------------------------------------------------------------------
// Async wrapper (backward-compatible)
// ---------------------------------------------------------------------------

async function answerChat(
  input: AnswerChatInput,
): Promise<RouteResponse<ChatTurnValue | MessageBody>> {
  return Effect.runPromise(answerChatEffect(input).pipe(Effect.catchAllCause((cause) => {
    const failure = toChatRouteFailure(getCauseSummary(cause), Cause.squash(cause))
    return Effect.succeed(routeResult.error(failure.status, failure.message))
  })))
}

export const chatAnswerRouteService: ChatAnswerRouteService = {
  answerChat,
}

async function hardenSingleChatAsset(input: {
  readonly workspaceId: string
  readonly parsedStorage: BlobParsedDocumentStorage
  readonly source: ChatSource
  readonly sourcePath: string
  readonly assetUrl?: string | null
  readonly contentType?: string | null
}): Promise<string | null> {
  if (input.source.status !== "ready" || !input.source.knowhereDocumentId) {
    return null
  }

  if (input.source.demoKey) {
    if (input.source.namespace === "__knowhere_demo__" && !input.source.jobResultId) return null
    const demoAssetUrl = resolveDemoSourceAssetUrl({
      demoSourceId: input.source.demoKey,
      sourcePath: input.sourcePath,
      jobResultId: input.source.jobResultId,
    })
    if (!demoAssetUrl) return null

    return hardenChatAssetByDocument({
      workspaceId: input.workspaceId,
      parsedStorage: input.parsedStorage,
      documentId: input.source.knowhereDocumentId,
      revisionKey: input.source.jobResultId ?? input.source.knowhereDocumentId,
      sourcePath: input.sourcePath,
      assetUrl: demoAssetUrl,
      contentType: input.contentType,
      sourceId: input.source.id,
    })
  }

  if (!input.source.knowhereJobId) return null

  return hardenChatAssetByDocument({
    workspaceId: input.workspaceId,
    parsedStorage: input.parsedStorage,
    documentId: input.source.knowhereDocumentId,
    revisionKey: input.source.knowhereJobId,
    sourcePath: input.sourcePath,
    assetUrl: input.assetUrl,
    contentType: input.contentType,
    sourceId: input.source.id,
  })
}

function resolveDemoSourceAssetUrl(input: {
  readonly demoSourceId: string
  readonly sourcePath: string
  readonly jobResultId?: string
}): string | null {
  const normalizedPath = input.sourcePath
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
  const pathSegments = normalizedPath.split("/")
  if (
    pathSegments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    return null
  }

  const encodedPath = pathSegments.map(encodeURIComponent).join("/")
  return knowhereDemoApi.resolveApiURL(
    `/api/v1/demo/sources/${encodeURIComponent(input.demoSourceId)}/assets/${encodedPath}${input.jobResultId ? `?job_result_id=${encodeURIComponent(input.jobResultId)}` : ""}`,
  )
}

async function hardenChatAssetByDocument(input: {
  readonly workspaceId: string
  readonly parsedStorage: BlobParsedDocumentStorage
  readonly documentId: string
  readonly revisionKey: string
  readonly sourcePath: string
  readonly assetUrl?: string | null
  readonly contentType?: string | null
  readonly sourceId?: string | null
}): Promise<string | null> {
  try {
    const existingUrl = await input.parsedStorage.getAssetUrl({
      documentId: input.documentId,
      revisionKey: input.revisionKey,
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
      documentId: input.documentId,
      revisionKey: input.revisionKey,
      sourcePath: input.sourcePath,
      body: fetchedAsset.body,
      contentType: fetchedAsset.contentType,
    })

    return (
      writtenAsset.url ??
      (await input.parsedStorage.getAssetUrl({
        documentId: input.documentId,
        revisionKey: input.revisionKey,
        sourcePath: input.sourcePath,
      }))
    )
  } catch (error) {
    logger.warn("chat: single parsed asset hardening failed", {
      workspaceId: input.workspaceId,
      sourceId: input.sourceId ?? null,
      documentId: input.documentId,
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

function toChatRouteFailure(detail: string, error?: unknown): ChatRouteFailure {
  const routeDetail = getSafeRouteDetail(detail)
  const status = resolveUpstreamFailureStatus(error)
  if (status) return { status, message: `Chat generation failed: ${routeDetail}` }
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

function resolveUpstreamFailureStatus(error: unknown, depth: number = 0): ChatRouteFailure["status"] | undefined {
  if (depth > 5 || typeof error !== "object" || error === null) return undefined
  if (Runtime.isFiberFailure(error)) {
    const cause: Cause.Cause<unknown> = error[Runtime.FiberFailureCauseId]
    const status: ChatRouteFailure["status"] | undefined = resolveUpstreamFailureStatus(Cause.squash(cause), depth + 1)
    if (status) return status
  }
  const status: unknown = Reflect.get(error, "status") ?? Reflect.get(error, "statusCode")
  if (status === 401 || status === 409 || status === 429 || status === 503) return status
  for (const key of ["cause", "error", "response", "defect"]) {
    const nested: ChatRouteFailure["status"] | undefined = resolveUpstreamFailureStatus(Reflect.get(error, key), depth + 1)
    if (nested) return nested
  }
  return undefined
}
