import { Cause, Effect, Either, Option } from "effect"

import {
  generateAgenticOutputManifest,
  parseChatRequestBody,
} from "@/domains/chat"
import type {
  ImageInspectionAsset,
  ImageInspectionRequest,
  ImageInspectionResponse,
  ImageInspectionSkippedAsset,
  InspectImages,
} from "@/agent-harness"
import { normalizeImageInspectionHighlights } from "@/agent-harness/image-highlights"
import { generateImageInspectionModelResult } from "@/domains/chat/image-inspection-model"
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
import { CHAT_MODEL } from "@/lib/ai"
import type { HardenChatAssetUrl } from "./media-assets"
import { isAuthError } from "@/integrations/dashboard/api-key-service"
import { makeKnowhereClientWithParsedStorage } from "@/integrations/knowhere"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"
import { routeResult, type RouteResult } from "@/lib/route-result"

type RouteResponse<TBody> = RouteResult<TBody>

const VISION_MODEL = process.env.VISION_MODEL ?? CHAT_MODEL
const IMAGE_INSPECTION_URL_REPLACEMENT = "[image URL hidden]"
const SUPPORTED_IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
} as const

type HardenImageInspectionAsset = (input: {
  readonly documentId: string
  readonly revisionKey: string
  readonly sourcePath: string
  readonly assetUrl?: string | null
  readonly contentType?: string | null
}) => Promise<string | null>

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
    const hardenImageInspectionAsset: HardenImageInspectionAsset = (asset) =>
      hardenChatAssetByDocument({
        workspaceId: workspace.id,
        parsedStorage,
        documentId: asset.documentId,
        revisionKey: asset.revisionKey,
        sourcePath: asset.sourcePath,
        assetUrl: asset.assetUrl,
        contentType: asset.contentType,
      })
    const inspectImages: InspectImages = (request) =>
      inspectChatImages({
        workspaceId: workspace.id,
        sources,
        hardenChatAssetUrl,
        hardenImageInspectionAsset,
        request,
      })

    const result: Either.Either<ChatTurnValue, ChatAnswerFailure> =
      yield* Effect.tryPromise(() =>
        handleChatTurn({
          workspace,
          sources,
          question: body.value.question,
          threadId: body.value.threadId,
          useAgentic: body.value.useAgentic,
          excludedSourceIds: body.value.excludedSourceIds,
          retrieval: client.retrieval,
          knowledge: knowhereResources.knowledge,
          remoteDocumentClient: client,
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
          inspectImages,
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

async function inspectChatImages(input: {
  readonly workspaceId: string
  readonly sources: readonly Source[]
  readonly hardenChatAssetUrl: HardenChatAssetUrl
  readonly hardenImageInspectionAsset: HardenImageInspectionAsset
  readonly request: ImageInspectionRequest
}): Promise<ImageInspectionResponse> {
  const preparedAssets: PreparedImageInspectionAsset[] = []
  const skippedAssets: ImageInspectionSkippedAsset[] = []

  for (const asset of input.request.assets) {
    const preparedAsset = await prepareImageInspectionAsset({
      asset,
      sources: input.sources,
      hardenChatAssetUrl: input.hardenChatAssetUrl,
      hardenImageInspectionAsset: input.hardenImageInspectionAsset,
    })
    if (preparedAsset.ok) {
      preparedAssets.push(preparedAsset.asset)
    } else {
      skippedAssets.push({
        ref: asset.ref,
        reason: preparedAsset.reason,
      })
    }
  }

  if (preparedAssets.length === 0) {
    return {
      analysis: "",
      inspected: [],
      skipped: skippedAssets,
    }
  }

  logger.info("chat: image inspection request", {
    workspaceId: input.workspaceId,
    model: VISION_MODEL,
    requestedCount: input.request.assets.length,
    inspectedCount: preparedAssets.length,
    skippedCount: skippedAssets.length,
    refs: preparedAssets.map((asset) => asset.ref),
  })

  const response = await generateImageInspectionModelResult({
    workspaceId: input.workspaceId,
    question: input.request.question,
    assets: preparedAssets,
  })
  const analysis = removeImageInspectionUrls({
    text: response.analysis,
    assets: preparedAssets,
  })
  const highlights = normalizeImageInspectionHighlights({
    pages: response.pages,
    allowedRefs: new Set(preparedAssets.map((asset) => asset.ref)),
  })

  logger.info("chat: image inspection response", {
    workspaceId: input.workspaceId,
    model: VISION_MODEL,
    inspectedCount: preparedAssets.length,
    skippedCount: skippedAssets.length,
    analysisLength: analysis.length,
    inspectionSource: response.source,
    highlightPageCount: highlights.length,
    highlightRegionCount: highlights.reduce(
      (count, page) => count + page.regions.length,
      0,
    ),
  })

  return {
    analysis,
    inspected: preparedAssets.map((asset) => ({
      ref: asset.ref,
      label: asset.label,
    })),
    skipped: skippedAssets,
    ...(highlights.length > 0 ? { highlights } : {}),
  }
}

type PreparedImageInspectionAsset = {
  readonly ref: string
  readonly label: string
  readonly url: URL
  readonly body: Uint8Array
  readonly contentType: string
  readonly fileName?: string
}

type PrepareImageInspectionAssetResult =
  | {
      readonly ok: true
      readonly asset: PreparedImageInspectionAsset
    }
  | {
      readonly ok: false
      readonly reason: string
    }

async function prepareImageInspectionAsset(input: {
  readonly asset: ImageInspectionAsset
  readonly sources: readonly Source[]
  readonly hardenChatAssetUrl: HardenChatAssetUrl
  readonly hardenImageInspectionAsset: HardenImageInspectionAsset
}): Promise<PrepareImageInspectionAssetResult> {
  const sourcePath = resolveImageInspectionSourcePath(input.asset)
  if (!sourcePath) {
    return {
      ok: false,
      reason: "The image asset path could not be resolved.",
    }
  }

  const contentType = getSupportedImageContentType(sourcePath)
  if (!contentType) {
    return {
      ok: false,
      reason: "Only PNG, JPEG, and WebP image assets can be inspected.",
    }
  }

  const source = resolveImageInspectionSource(input.asset, input.sources)
  const durableUrlFromSource = source
    ? await input.hardenChatAssetUrl({
        source,
        sourcePath,
        assetUrl: input.asset.assetUrl,
        contentType,
      })
    : null
  const durableUrl =
    durableUrlFromSource ??
    (await hardenImageInspectionAssetByRef({
      asset: input.asset,
      sourcePath,
      contentType,
      hardenImageInspectionAsset: input.hardenImageInspectionAsset,
    }))
  if (!durableUrl) {
    return {
      ok: false,
      reason: source
        ? "The image asset was unavailable in Notebook storage."
        : "No ready Notebook source matched the image asset.",
    }
  }

  const url = parseAbsoluteHttpUrl(durableUrl)
  if (!url) {
    return {
      ok: false,
      reason: "Notebook storage did not return a valid image URL.",
    }
  }
  const image = await fetchPreparedInspectionImage({
    url,
    contentType,
  })
  if (!image.ok) {
    return {
      ok: false,
      reason: image.reason,
    }
  }

  return {
    ok: true,
    asset: {
      ref: input.asset.ref,
      label: input.asset.label,
      url,
      body: image.body,
      contentType,
      fileName: getFileNameFromPath(sourcePath),
    },
  }
}

async function fetchPreparedInspectionImage(input: {
  readonly url: URL
  readonly contentType: string
}): Promise<
  | {
      readonly ok: true
      readonly body: Uint8Array
    }
  | {
      readonly ok: false
      readonly reason: string
    }
> {
  try {
    const image = await fetchChatAsset({
      assetUrl: input.url.toString(),
      fallbackContentType: input.contentType,
    })
    return {
      ok: true,
      body: image.body,
    }
  } catch {
    return {
      ok: false,
      reason: "The Notebook image asset could not be read for inspection.",
    }
  }
}

async function hardenImageInspectionAssetByRef(input: {
  readonly asset: ImageInspectionAsset
  readonly sourcePath: string
  readonly contentType: string
  readonly hardenImageInspectionAsset: HardenImageInspectionAsset
}): Promise<string | null> {
  const documentId = getTrimmedString(input.asset.source.documentId)
  const revisionKey = getTrimmedString(input.asset.revisionKey)
  if (!documentId || !revisionKey) return null

  return input.hardenImageInspectionAsset({
    documentId,
    revisionKey,
    sourcePath: input.sourcePath,
    assetUrl: input.asset.assetUrl,
    contentType: input.contentType,
  })
}

function resolveImageInspectionSource(
  asset: ImageInspectionAsset,
  sources: readonly Source[],
): Source | undefined {
  const documentId = getTrimmedString(asset.source.documentId)
  if (!documentId) return undefined

  return sources.find(
    (source) =>
      source.status === "ready" && source.knowhereDocumentId === documentId,
  )
}

function resolveImageInspectionSourcePath(
  asset: ImageInspectionAsset,
): string | null {
  const candidates = [
    asset.sourcePath,
    asset.source.sectionPath,
    getAssetUrlPathname(asset.assetUrl),
  ]
  for (const candidate of candidates) {
    const sourcePath = getSupportedImageAssetPath(candidate)
    if (sourcePath) return sourcePath
  }

  return null
}

function getSupportedImageAssetPath(
  value: string | null | undefined,
): string | null {
  const normalizedText = normalizeSourcePathCandidate(value)
  if (!normalizedText) return null

  const match =
    /(?:^|\/)((?:images|pages|page_citation_assets)\/[^?#]+)(?:[?#]|$)?/i.exec(
      normalizedText,
    )
  const matchedPath = match?.[1]
  return matchedPath ? matchedPath.trim() : null
}

function getSupportedImageContentType(sourcePath: string): string | null {
  const lowerPath = sourcePath.toLowerCase()
  const extension = Object.keys(SUPPORTED_IMAGE_CONTENT_TYPES).find((candidate) =>
    lowerPath.endsWith(candidate),
  )
  return extension ? SUPPORTED_IMAGE_CONTENT_TYPES[extension] ?? null : null
}

function removeImageInspectionUrls(input: {
  readonly text: string
  readonly assets: readonly PreparedImageInspectionAsset[]
}): string {
  const knownUrls = input.assets.map((asset) => asset.url.toString())
  const withoutKnownUrls = knownUrls.reduce(
    (text, assetUrl) =>
      text.replaceAll(assetUrl, IMAGE_INSPECTION_URL_REPLACEMENT),
    input.text,
  )

  return withoutKnownUrls
    .replace(/https?:\/\/[^\s)\]}>"']+/g, IMAGE_INSPECTION_URL_REPLACEMENT)
    .replace(/[ \t]{2,}/g, " ")
    .trim()
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

function getAssetUrlPathname(assetUrl: string | null | undefined): string | null {
  const normalizedAssetUrl = getTrimmedString(assetUrl)
  if (!normalizedAssetUrl) return null

  try {
    return new URL(normalizedAssetUrl).pathname
  } catch {
    return normalizedAssetUrl.split("?")[0] ?? normalizedAssetUrl
  }
}

function normalizeSourcePathCandidate(
  value: string | null | undefined,
): string | null {
  const trimmedValue = getTrimmedString(value)
  if (!trimmedValue) return null

  const normalized = decodeUrlText(trimmedValue)
    .replaceAll("\\", "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()

  return normalized.length > 0 ? normalized : null
}

function decodeUrlText(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseAbsoluteHttpUrl(assetUrl: string): URL | null {
  try {
    const url = new URL(assetUrl)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

function getFileNameFromPath(sourcePath: string): string | undefined {
  const fileName = sourcePath.replaceAll("\\", "/").split("/").pop()?.trim()
  return fileName && fileName.length > 0 ? fileName : undefined
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
