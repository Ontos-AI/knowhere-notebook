import "server-only"

import path from "node:path"
import { createHash } from "node:crypto"
import { get as getBlob, put } from "@vercel/blob"
import { after } from "next/server"
import { Effect } from "effect"
import type {
  DocumentChunk,
  DocumentChunkListResponse,
} from "@ontos-ai/knowhere-sdk"

import {
  resolveChunkConnectionTargets,
  toParsedChunkView,
  type ChunkKnowhereClient,
  type ChunkPage,
  type ChunkPageParams,
  type LoadChunksOptions,
} from "@/domains/chunks"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { Source } from "@/infrastructure/db/schema"
import { logger } from "@/lib/logger"

type ChunkPageMode = "visible" | "structure"

type ChunkPageBlobGetResult =
  | {
      readonly statusCode: 200
      readonly stream: ReadableStream<Uint8Array>
    }
  | {
      readonly statusCode: 304
      readonly stream: null
    }

type ChunkPageBlobPutOptions = {
  readonly access: "public"
  readonly allowOverwrite: boolean
  readonly contentType: string
  readonly multipart?: boolean
}

type ChunkPageBlobStore = {
  readonly get: (
    pathname: string,
    options: { readonly access: "public" },
  ) => Promise<ChunkPageBlobGetResult | null>
  readonly put: (
    pathname: string,
    body: string | Buffer,
    options: ChunkPageBlobPutOptions,
  ) => Promise<{ readonly url: string }>
}

type FetchChunkAsset = (assetUrl: string) => Promise<Response>

type ChunkPageWarmScheduler = (task: () => Promise<void>) => void

type ServerLoadChunksOptions = LoadChunksOptions & {
  readonly workspaceId?: string
  readonly cacheStore?: ChunkPageBlobStore
  readonly fetchAsset?: FetchChunkAsset
  readonly mode?: ChunkPageMode
  readonly onRevisionKey?: (revisionKey: string) => Promise<void>
  readonly scheduleWarm?: ChunkPageWarmScheduler
}

type WarmChunkPageCacheInput = {
  readonly source: Source
  readonly client: ChunkKnowhereClient
  readonly params: ChunkPageParams
  readonly revisionKey: string
  readonly workspaceId: string
  readonly cacheStore: ChunkPageBlobStore
  readonly fetchAsset: FetchChunkAsset
  readonly scheduleWarm: ChunkPageWarmScheduler
  readonly startAssetIndex?: number
  readonly mirroredAssetUrlsByOriginalUrl?: Readonly<Record<string, string>>
}

type MirrorableChunkAsset = {
  readonly chunkId: string
  readonly chunkType: "image" | "table"
  readonly assetUrl: string
  readonly filePath?: string
}

const documentChunkPageSize = 200
const visibleChunkPageMode: ChunkPageMode = "visible"
const structureChunkPageMode: ChunkPageMode = "structure"
const maximumMirroredAssetsPerWarmStep = 50
const maximumWarmStepDurationMs = 45_000
const assetMirrorConcurrency = 10

const defaultBlobStore: ChunkPageBlobStore = {
  get: (pathname, options) => getBlob(pathname, options),
  put: (pathname, body, options) =>
    put(pathname, body, {
      access: options.access,
      allowOverwrite: options.allowOverwrite,
      contentType: options.contentType,
      multipart: options.multipart,
    }),
}

const defaultFetchAsset: FetchChunkAsset = (assetUrl: string) => fetch(assetUrl)

const defaultScheduleWarm: ChunkPageWarmScheduler = (
  task: () => Promise<void>,
) => {
  try {
    after(task)
  } catch {
    void task()
  }
}

export const loadChunksForSource = (
  source: Source,
  client: ChunkKnowhereClient,
  options: ServerLoadChunksOptions = {},
) =>
  Effect.gen(function* () {
    if (source.status !== "ready" || !source.knowhereDocumentId) return []

    const chunks: ParsedChunkView[] = []
    let page = 1
    let totalPages = 1

    do {
      const chunkPage = yield* loadChunkPageForSource(source, client, {
        page,
        pageSize: documentChunkPageSize,
      }, {
        ...options,
        mode: structureChunkPageMode,
      })
      chunks.push(...chunkPage.chunks)
      totalPages = chunkPage.pagination.totalPages
      page += 1
    } while (page <= totalPages)

    return resolveChunkConnectionTargets(chunks)
  })

export const loadChunkPageForSource = (
  source: Source,
  client: ChunkKnowhereClient,
  params: ChunkPageParams,
  options: ServerLoadChunksOptions = {},
) =>
  Effect.gen(function* () {
    const emptyPage = createEmptyChunkPage(params)
    if (source.status !== "ready" || !source.knowhereDocumentId) {
      return emptyPage
    }

    const mode = options.mode ?? visibleChunkPageMode
    const workspaceId = options.workspaceId ?? source.workspaceId
    const cacheStore = options.cacheStore ?? defaultBlobStore
    const includeAssetUrls = mode === visibleChunkPageMode
    const revisionProbeResponse = yield* Effect.promise(() =>
      client.documents.listChunks(source.knowhereDocumentId!, {
        page: params.page,
        pageSize: params.pageSize,
        includeAssetUrls: false,
      }),
    )
    const probeRevisionKey = getRevisionKey(revisionProbeResponse, source)
    if (probeRevisionKey) {
      scheduleRevisionKeyUpdate(source, probeRevisionKey, options.onRevisionKey)
      const cachedPage = yield* Effect.promise(() =>
        readCachedChunkPage({
          cacheStore,
          documentId: source.knowhereDocumentId!,
          mode,
          params,
          revisionKey: probeRevisionKey,
          workspaceId,
        }),
      )
      if (cachedPage) return cachedPage
    }

    const response = includeAssetUrls
      ? yield* Effect.promise(() =>
          client.documents.listChunks(source.knowhereDocumentId!, {
            page: params.page,
            pageSize: params.pageSize,
            includeAssetUrls,
          }),
        )
      : revisionProbeResponse
    const revisionKey = getRevisionKey(response, source) ?? probeRevisionKey
    if (revisionKey && revisionKey !== probeRevisionKey) {
      scheduleRevisionKeyUpdate(source, revisionKey, options.onRevisionKey)
    }

    const chunkPage = createChunkPageFromResponse({
      response,
      source,
      params,
      options:
        mode === visibleChunkPageMode
          ? { assetUrlsByFilePath: options.assetUrlsByFilePath }
          : {},
    })

    if (revisionKey) {
      if (mode === visibleChunkPageMode) {
        scheduleChunkPageWarm({
          source,
          client,
          params,
          revisionKey,
          workspaceId,
          cacheStore,
          fetchAsset: options.fetchAsset ?? defaultFetchAsset,
          scheduleWarm: options.scheduleWarm ?? defaultScheduleWarm,
        })
      } else {
        scheduleStructurePageCacheWrite({
          cacheStore,
          chunkPage,
          documentId: source.knowhereDocumentId,
          mode,
          params,
          revisionKey,
          scheduleWarm: options.scheduleWarm ?? defaultScheduleWarm,
          workspaceId,
        })
      }
    }

    return chunkPage
  })

export async function warmChunkPageCache(
  input: WarmChunkPageCacheInput,
): Promise<void> {
  const response = await input.client.documents.listChunks(
    input.source.knowhereDocumentId!,
    {
      page: input.params.page,
      pageSize: input.params.pageSize,
      includeAssetUrls: true,
    },
  )
  const assets = collectMirrorableChunkAssets(response.chunks)
  const startAssetIndex = input.startAssetIndex ?? 0
  const mirroredAssetUrls = new Map(
    Object.entries(input.mirroredAssetUrlsByOriginalUrl ?? {}),
  )

  const stepStartedAt = Date.now()
  const assetBatch = assets.slice(
    startAssetIndex,
    startAssetIndex + maximumMirroredAssetsPerWarmStep,
  )
  const mirroredBatch = await mirrorChunkAssets({
    assets: assetBatch,
    cacheStore: input.cacheStore,
    fetchAsset: input.fetchAsset,
    revisionKey: input.revisionKey,
    source: input.source,
  })
  for (const mirroredAsset of mirroredBatch) {
    mirroredAssetUrls.set(mirroredAsset.assetUrl, mirroredAsset.blobUrl)
  }

  const nextAssetIndex = startAssetIndex + assetBatch.length
  if (
    nextAssetIndex < assets.length &&
    Date.now() - stepStartedAt < maximumWarmStepDurationMs
  ) {
    input.scheduleWarm(() =>
      warmChunkPageCache({
        ...input,
        startAssetIndex: nextAssetIndex,
        mirroredAssetUrlsByOriginalUrl: Object.fromEntries(mirroredAssetUrls),
      }),
    )
    return
  }

  if (nextAssetIndex < assets.length) {
    input.scheduleWarm(() =>
      warmChunkPageCache({
        ...input,
        startAssetIndex: nextAssetIndex,
        mirroredAssetUrlsByOriginalUrl: Object.fromEntries(mirroredAssetUrls),
      }),
    )
    return
  }

  const rewrittenChunks = response.chunks.map((chunk) =>
    rewriteChunkAssetUrl(chunk, mirroredAssetUrls),
  )
  const chunkPage = createChunkPageFromResponse({
    response: {
      ...response,
      chunks: rewrittenChunks,
    },
    source: input.source,
    params: input.params,
    options: {},
  })

  await writeCachedChunkPage({
    cacheStore: input.cacheStore,
    chunkPage,
    documentId: input.source.knowhereDocumentId!,
    mode: visibleChunkPageMode,
    params: input.params,
    revisionKey: input.revisionKey,
    workspaceId: input.workspaceId,
  })
}

function scheduleChunkPageWarm(input: WarmChunkPageCacheInput): void {
  input.scheduleWarm(async () => {
    try {
      await warmChunkPageCache(input)
    } catch (error) {
      logger.warn("chunks: chunk page cache warm failed", {
        sourceId: input.source.id,
        documentId: input.source.knowhereDocumentId,
        page: input.params.page,
        pageSize: input.params.pageSize,
        revisionKey: input.revisionKey,
        error: getErrorMessage(error),
      })
    }
  })
}

function scheduleStructurePageCacheWrite(input: {
  readonly cacheStore: ChunkPageBlobStore
  readonly chunkPage: ChunkPage
  readonly documentId: string
  readonly mode: ChunkPageMode
  readonly params: ChunkPageParams
  readonly revisionKey: string
  readonly scheduleWarm: ChunkPageWarmScheduler
  readonly workspaceId: string
}): void {
  input.scheduleWarm(async () => {
    try {
      await writeCachedChunkPage(input)
    } catch (error) {
      logger.warn("chunks: structure chunk page cache write failed", {
        documentId: input.documentId,
        page: input.params.page,
        pageSize: input.params.pageSize,
        revisionKey: input.revisionKey,
        error: getErrorMessage(error),
      })
    }
  })
}

async function readCachedChunkPage(input: {
  readonly cacheStore: ChunkPageBlobStore
  readonly documentId: string
  readonly mode: ChunkPageMode
  readonly params: ChunkPageParams
  readonly revisionKey: string
  readonly workspaceId: string
}): Promise<ChunkPage | null> {
  const pathname = getChunkPageCachePathname(input)
  const result = await input.cacheStore
    .get(pathname, { access: "public" })
    .catch((error: unknown) => {
      logger.warn("chunks: chunk page cache read failed", {
        documentId: input.documentId,
        page: input.params.page,
        pageSize: input.params.pageSize,
        revisionKey: input.revisionKey,
        error: getErrorMessage(error),
      })
      return null
    })
  if (!result || result.statusCode !== 200) return null

  const text = await new Response(result.stream).text()
  return parseCachedChunkPage(text)
}

async function writeCachedChunkPage(input: {
  readonly cacheStore: ChunkPageBlobStore
  readonly chunkPage: ChunkPage
  readonly documentId: string
  readonly mode: ChunkPageMode
  readonly params: ChunkPageParams
  readonly revisionKey: string
  readonly workspaceId: string
}): Promise<void> {
  await input.cacheStore.put(
    getChunkPageCachePathname(input),
    JSON.stringify(input.chunkPage),
    {
      access: "public",
      allowOverwrite: true,
      contentType: "application/json; charset=utf-8",
    },
  )
}

function createChunkPageFromResponse(input: {
  readonly response: {
    readonly chunks: readonly DocumentChunk[]
    readonly pagination?: {
      readonly page?: number
      readonly pageSize?: number
      readonly total?: number
      readonly totalPages?: number
    }
  }
  readonly source: Source
  readonly params: ChunkPageParams
  readonly options: LoadChunksOptions
}): ChunkPage {
  const chunks = input.response.chunks.map((chunk) =>
    toParsedChunkView(
      chunk,
      input.source.title,
      input.source.knowhereDocumentId ?? undefined,
      input.options,
    ),
  )

  return {
    chunks,
    pagination: {
      page: getFiniteNonNegativeNumber(
        input.response.pagination?.page,
        input.params.page,
      ),
      pageSize: getFiniteNonNegativeNumber(
        input.response.pagination?.pageSize,
        input.params.pageSize,
      ),
      total: getFiniteNonNegativeNumber(
        input.response.pagination?.total,
        chunks.length,
      ),
      totalPages: getFiniteNonNegativeNumber(
        input.response.pagination?.totalPages,
        Math.ceil(chunks.length / input.params.pageSize),
      ),
    },
  }
}

function createEmptyChunkPage(params: ChunkPageParams): ChunkPage {
  return {
    chunks: [],
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total: 0,
      totalPages: 0,
    },
  }
}

function parseCachedChunkPage(text: string): ChunkPage | null {
  try {
    const value: unknown = JSON.parse(text)
    if (!isRecord(value)) return null
    const chunks = value["chunks"]
    const pagination = value["pagination"]
    if (!Array.isArray(chunks) || !isRecord(pagination)) return null
    const page = getNumber(pagination["page"])
    const pageSize = getNumber(pagination["pageSize"])
    const total = getNumber(pagination["total"])
    const totalPages = getNumber(pagination["totalPages"])
    if (
      page === undefined ||
      pageSize === undefined ||
      total === undefined ||
      totalPages === undefined
    ) {
      return null
    }

    return {
      chunks: chunks.filter(isParsedChunkView),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    }
  } catch {
    return null
  }
}

async function mirrorChunkAssets(input: {
  readonly assets: readonly MirrorableChunkAsset[]
  readonly cacheStore: ChunkPageBlobStore
  readonly fetchAsset: FetchChunkAsset
  readonly revisionKey: string
  readonly source: Source
}): Promise<
  readonly {
    readonly assetUrl: string
    readonly blobUrl: string
  }[]
> {
  return mapWithConcurrency(
    input.assets,
    assetMirrorConcurrency,
    async (asset) => {
      const response = await input.fetchAsset(asset.assetUrl)
      if (!response.ok) {
        throw new Error(
          `Chunk asset fetch failed with status ${response.status}.`,
        )
      }

      const body = Buffer.from(await response.arrayBuffer())
      const blob = await input.cacheStore.put(
        getMirroredAssetPathname({
          asset,
          revisionKey: input.revisionKey,
          source: input.source,
        }),
        body,
        {
          access: "public",
          allowOverwrite: true,
          contentType: getMirroredAssetContentType(asset, response),
          multipart: true,
        },
      )
      return {
        assetUrl: asset.assetUrl,
        blobUrl: blob.url,
      }
    },
  )
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  mapInput: (input: Input) => Promise<Output>,
): Promise<readonly Output[]> {
  const results: Array<Output | undefined> = []
  let nextIndex = 0
  const workerCount = Math.min(concurrency, inputs.length)

  async function runWorker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex
      nextIndex += 1
      const input = inputs[index]
      if (input === undefined) return
      results[index] = await mapInput(input)
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker()),
  )

  return results.filter(
    (result): result is Output => result !== undefined,
  )
}

function collectMirrorableChunkAssets(
  chunks: readonly DocumentChunk[],
): readonly MirrorableChunkAsset[] {
  return chunks.flatMap((chunk): readonly MirrorableChunkAsset[] => {
    if (chunk.chunkType !== "image" && chunk.chunkType !== "table") return []
    if (typeof chunk.assetUrl !== "string" || chunk.assetUrl.length === 0) {
      return []
    }

    return [
      {
        chunkId: chunk.id,
        chunkType: chunk.chunkType,
        assetUrl: chunk.assetUrl,
        ...(chunk.filePath ? { filePath: chunk.filePath } : {}),
      },
    ]
  })
}

function rewriteChunkAssetUrl(
  chunk: DocumentChunk,
  mirroredAssetUrls: ReadonlyMap<string, string>,
): DocumentChunk {
  if (typeof chunk.assetUrl !== "string") return chunk
  const mirroredAssetUrl = mirroredAssetUrls.get(chunk.assetUrl)
  return mirroredAssetUrl ? { ...chunk, assetUrl: mirroredAssetUrl } : chunk
}

function getChunkPageCachePathname(input: {
  readonly documentId: string
  readonly mode: ChunkPageMode
  readonly params: ChunkPageParams
  readonly revisionKey: string
  readonly workspaceId: string
}): string {
  return [
    "workspaces",
    encodePathSegment(input.workspaceId),
    "chunk-pages",
    encodePathSegment(input.documentId),
    encodePathSegment(input.revisionKey),
    input.mode,
    `page-${input.params.page}-size-${input.params.pageSize}.json`,
  ].join("/")
}

function getMirroredAssetPathname(input: {
  readonly asset: MirrorableChunkAsset
  readonly revisionKey: string
  readonly source: Source
}): string {
  const basename = getMirroredAssetBasename(input.asset)
  return [
    "workspaces",
    encodePathSegment(input.source.workspaceId),
    "sources",
    encodePathSegment(input.source.id),
    "chunk-assets",
    encodePathSegment(input.revisionKey),
    `${hashValue(input.asset.assetUrl)}-${basename}`,
  ].join("/")
}

function getMirroredAssetBasename(asset: MirrorableChunkAsset): string {
  const candidate =
    asset.filePath ??
    getUrlPathname(asset.assetUrl).split("/").filter(Boolean).at(-1) ??
    `${asset.chunkId}.bin`
  return candidate.replace(/[^a-zA-Z0-9._-]+/g, "-")
}

function getMirroredAssetContentType(
  asset: MirrorableChunkAsset,
  response: Response,
): string {
  const headerContentType = response.headers.get("content-type")
  if (headerContentType) return headerContentType
  if (asset.chunkType === "table") return "text/html; charset=utf-8"

  const extension = path.extname(asset.filePath ?? getUrlPathname(asset.assetUrl))
    .toLowerCase()
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".webp") return "image/webp"
  if (extension === ".gif") return "image/gif"
  return "application/octet-stream"
}

function getRevisionKey(
  response: Pick<DocumentChunkListResponse, "jobId" | "jobResultId">,
  source: Source,
): string | null {
  return (
    getNonEmptyString(response.jobId) ??
    getNonEmptyString(response.jobResultId) ??
    getFallbackRevisionKey(source)
  )
}

function getFallbackRevisionKey(source: Source): string | null {
  return (
    getNonEmptyString(source.knowhereJobId) ??
    getNonEmptyString(source.knowhereDocumentId)
  )
}

function scheduleRevisionKeyUpdate(
  source: Source,
  revisionKey: string,
  onRevisionKey: ((revisionKey: string) => Promise<void>) | undefined,
): void {
  if (!onRevisionKey || source.knowhereJobId === revisionKey) return

  void onRevisionKey(revisionKey).catch((error: unknown) => {
    logger.warn("chunks: source revision key update failed", {
      sourceId: source.id,
      documentId: source.knowhereDocumentId,
      revisionKey,
      error: getErrorMessage(error),
    })
  })
}

function getFiniteNonNegativeNumber(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function isParsedChunkView(value: unknown): value is ParsedChunkView {
  if (!isRecord(value)) return false
  return (
    typeof value["chunkId"] === "string" &&
    typeof value["type"] === "string" &&
    typeof value["content"] === "string" &&
    typeof value["sourceTitle"] === "string"
  )
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getUrlPathname(value: string): string {
  try {
    return new URL(value).pathname
  } catch {
    return value.split("?")[0] ?? value
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
