import "server-only"

import path from "node:path"
import {
  completeMultipartUpload as completeVercelMultipartUpload,
  createMultipartUpload as createVercelMultipartUpload,
  put,
  uploadPart as uploadVercelPart,
} from "@vercel/blob"
import { Effect } from "effect"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import { logger } from "@/lib/logger"

export type StoredParsedResultAssets = {
  resultBlobUrl: string
  assetUrlsByFilePath: Readonly<Record<string, string>>
}

export type MultipartUploadPart = {
  readonly etag: string
  readonly partNumber: number
}

export type ParsedResultBlobStore = {
  put(
    pathname: string,
    body: Buffer | string,
    options: {
      access?: "public"
      allowOverwrite?: boolean
      contentType: string
      multipart?: boolean
    },
  ): Promise<{ url: string }>
}

export type ResultZipMultipartBlobStore = {
  createMultipartUpload(
    pathname: string,
    options: ResultZipBlobOptions,
  ): Promise<{
    readonly key: string
    readonly uploadId: string
  }>
  uploadPart(
    pathname: string,
    body: Buffer,
    options: ResultZipUploadPartOptions,
  ): Promise<MultipartUploadPart>
  completeMultipartUpload(
    pathname: string,
    parts: readonly MultipartUploadPart[],
    options: ResultZipCompleteOptions,
  ): Promise<{ readonly url: string }>
}

export type ParsedResultAssetProgressRepository = {
  getParseResultProgress(
    workspaceId: string,
    sourceId: string,
  ): Promise<StoredParsedResultAssets | null>
  mergeParseAssetUrls(
    workspaceId: string,
    sourceId: string,
    input: StoredParsedResultAssets,
  ): Promise<unknown>
}

export type CreateResultZipMultipartUploadPlanInput = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly jobId: string
  readonly client: ResultZipJobClient
  readonly blobStore?: ResultZipMultipartBlobStore
  readonly fetchResult?: ResultZipFetch
  readonly partSizeBytes?: number
}

export type ResultZipMultipartUploadPlan = {
  readonly pathname: string
  readonly key: string
  readonly uploadId: string
  readonly sizeBytes: number
  readonly partSizeBytes: number
  readonly partCount: number
}

export type ResultZipPartRange = {
  readonly startByte: number
  readonly endByte: number
}

export type UploadResultZipPartInput = ResultZipPartRange & {
  readonly pathname: string
  readonly key: string
  readonly uploadId: string
  readonly partNumber: number
  readonly jobId: string
  readonly client: ResultZipJobClient
  readonly blobStore?: ResultZipMultipartBlobStore
  readonly fetchResult?: ResultZipFetch
}

export type CompleteResultZipMultipartUploadInput = {
  readonly pathname: string
  readonly key: string
  readonly uploadId: string
  readonly parts: readonly MultipartUploadPart[]
  readonly blobStore?: ResultZipMultipartBlobStore
}

export type PrepareParsedResultAssetBatchInput = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly jobId: string
  readonly documentId?: string
  readonly resultBlobUrl: string
  readonly client: {
    readonly jobs: {
      load(jobId: string): Promise<unknown>
    }
    readonly documents?: {
      listChunks(
        documentId: string,
        params: ParsedAssetChunkListParams,
      ): Promise<ParsedAssetChunkListResponse>
    }
  }
  readonly repository: ParsedResultAssetProgressRepository
  readonly blobStore?: ParsedResultBlobStore
  readonly batchLimit?: number
  readonly maxDurationMs?: number
}

export type PrepareParsedResultAssetBatchResult = {
  readonly uploadedCount: number
  readonly remainingCount: number
  readonly hasMore: boolean
}

type ResultZipJobClient = {
  readonly jobs: {
    get(jobId: string): Promise<Pick<JobResult, "resultUrl">>
  }
}

type ResultZipFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

type ResultZipBlobOptions = {
  readonly access: "public"
  readonly addRandomSuffix: false
  readonly allowOverwrite: true
  readonly contentType: "application/zip"
}

type ResultZipUploadPartOptions = ResultZipBlobOptions & {
  readonly key: string
  readonly uploadId: string
  readonly partNumber: number
}

type ResultZipCompleteOptions = ResultZipBlobOptions & {
  readonly key: string
  readonly uploadId: string
}

type ParsedImageChunk = {
  readonly filePath?: string
  readonly data?: Buffer
}

type ParsedTableChunk = {
  readonly filePath?: string
  readonly html?: string
}

type ParsedResultWithAssets = {
  readonly rawZip: Buffer
  readonly imageChunks?: readonly ParsedImageChunk[]
  readonly tableChunks?: readonly ParsedTableChunk[]
}

type ParsedAssetUpload = {
  readonly filePath: string
  readonly body: Buffer | string
  readonly contentType: string
}

type ParsedAssetChunkType = "image" | "table"

type ParsedAssetChunkListParams = {
  readonly page: number
  readonly pageSize: number
  readonly chunkType: ParsedAssetChunkType
  readonly includeAssetUrls?: boolean
}

type ParsedAssetChunkListResponse = {
  readonly chunks: readonly ParsedAssetChunkIndexItem[]
  readonly pagination?: {
    readonly totalPages?: number
  }
}

type ParsedAssetChunkIndexItem = {
  readonly filePath?: string | null
  readonly sourceChunkPath?: string | null
  readonly metadata: Readonly<Record<string, unknown>>
}

type ParsedAssetIndexCompletion =
  | {
      readonly kind: "complete"
      readonly assetCount: number
    }
  | {
      readonly kind: "missing"
      readonly missingCount: number
    }

export type StoreParsedResultAssetsInput = {
  workspaceId: string
  sourceId: string
  job: JobResult
  client: {
    jobs: {
      load(job: JobResult): Promise<unknown>
    }
  }
  blobStore?: ParsedResultBlobStore
}

const parsedResultDirectoryName = "parsed-result"
const resultZipPartSizeBytes = 8 * 1024 * 1024
const parsedAssetBatchLimit = 10
const parsedAssetBatchMaxDurationMs = 45_000
const parsedAssetChunkPageSize = 200
const resultZipMetadataTimeoutMs = 15_000
const resultZipRangeFetchTimeoutMs = 30_000
const resultZipBlobOperationTimeoutMs = 30_000
const parsedAssetBlobOperationTimeoutMs = 30_000

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

export const storeParsedResultAssetsEffect = Effect.fn(
  "storeParsedResultAssets",
)(
  function* ({
    workspaceId,
    sourceId,
    job,
    client,
    blobStore = vercelBlobStore,
  }: StoreParsedResultAssetsInput) {
    const parseResult = (yield* Effect.tryPromise(() =>
      client.jobs.load(job),
    )) as ParsedResultWithAssets
    const blobPrefix = getParsedResultBlobPrefix(workspaceId, sourceId)
    const resultBlob = yield* Effect.tryPromise(() =>
      blobStore.put(
        `${blobPrefix}/result.zip`,
        parseResult.rawZip,
        getBlobPutOptions("application/zip"),
      ),
    )

    const assetUrlsByFilePath: Record<string, string> = {}

    for (const image of parseResult.imageChunks ?? []) {
      const filePath = normalizeParsedAssetPath(image.filePath)
      if (!filePath || !image.data) continue

      const blob = yield* Effect.tryPromise(() =>
        blobStore.put(
          `${blobPrefix}/${filePath}`,
          image.data!,
          getBlobPutOptions(getContentTypeForPath(filePath)),
        ),
      )
      assetUrlsByFilePath[filePath] = blob.url
    }

    for (const table of parseResult.tableChunks ?? []) {
      const filePath = normalizeParsedAssetPath(table.filePath)
      if (!filePath || typeof table.html !== "string") continue

      const blob = yield* Effect.tryPromise(() =>
        blobStore.put(
          `${blobPrefix}/${filePath}`,
          table.html!,
          getBlobPutOptions("text/html; charset=utf-8"),
        ),
      )
      assetUrlsByFilePath[filePath] = blob.url
    }

    return {
      resultBlobUrl: resultBlob.url,
      assetUrlsByFilePath,
    }
  },
)

export const prepareParsedResultAssetBatchEffect = Effect.fn(
  "prepareParsedResultAssetBatch",
)(
  function* ({
    workspaceId,
    sourceId,
    jobId,
    documentId,
    resultBlobUrl,
    client,
    repository,
    blobStore = vercelBlobStore,
    batchLimit = parsedAssetBatchLimit,
    maxDurationMs = parsedAssetBatchMaxDurationMs,
  }: PrepareParsedResultAssetBatchInput) {
    const startedAt = Date.now()
    const progress = yield* Effect.tryPromise(() =>
      repository.getParseResultProgress(workspaceId, sourceId),
    )
    const existingAssetUrls = progress?.assetUrlsByFilePath ?? {}
    const indexedCompletion = yield* Effect.tryPromise(() =>
      getIndexedAssetCompletion({
        documentId,
        existingAssetUrls,
        client,
      }),
    ).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn(
            "parsed-result-assets: asset index check failed; falling back to result ZIP load",
            {
              workspaceId,
              sourceId,
              jobId,
              documentId,
              error: error instanceof Error ? error.message : String(error),
            },
          )
          return null
        }),
      ),
    )
    if (indexedCompletion?.kind === "complete") {
      logger.info("parsed-result-assets: asset index already complete", {
        workspaceId,
        sourceId,
        jobId,
        documentId,
        assetCount: indexedCompletion.assetCount,
      })
      return {
        uploadedCount: 0,
        remainingCount: 0,
        hasMore: false,
      }
    }

    const parseResult = (yield* Effect.tryPromise(() =>
      client.jobs.load(jobId),
    )) as ParsedResultWithAssets
    const assets = getUploadableParsedAssets(parseResult)
    const missingAssets = assets.filter(
      (asset) => existingAssetUrls[asset.filePath] === undefined,
    )
    const uploadedAssetUrls: Record<string, string> = {}
    const blobPrefix = getParsedResultBlobPrefix(workspaceId, sourceId)

    for (const asset of missingAssets) {
      const uploadedCount = Object.keys(uploadedAssetUrls).length
      if (uploadedCount >= batchLimit) break
      if (uploadedCount > 0 && Date.now() - startedAt >= maxDurationMs) break

      const blob = yield* Effect.tryPromise(() =>
        withTimeout(
          `Parsed asset upload for ${asset.filePath}`,
          parsedAssetBlobOperationTimeoutMs,
          blobStore.put(
            `${blobPrefix}/${asset.filePath}`,
            asset.body,
            getBlobPutOptions(asset.contentType),
          ),
        ),
      )
      uploadedAssetUrls[asset.filePath] = blob.url
    }

    if (Object.keys(uploadedAssetUrls).length > 0) {
      yield* Effect.tryPromise(() =>
        repository.mergeParseAssetUrls(workspaceId, sourceId, {
          resultBlobUrl: progress?.resultBlobUrl ?? resultBlobUrl,
          assetUrlsByFilePath: uploadedAssetUrls,
        }),
      )
    }

    const assetUrlsAfterBatch = {
      ...existingAssetUrls,
      ...uploadedAssetUrls,
    }
    const remainingCount = assets.filter(
      (asset) => assetUrlsAfterBatch[asset.filePath] === undefined,
    ).length

    return {
      uploadedCount: Object.keys(uploadedAssetUrls).length,
      remainingCount,
      hasMore: remainingCount > 0,
    }
  },
)

// ---------------------------------------------------------------------------
// Async wrapper (backward-compatible)
// ---------------------------------------------------------------------------

export async function storeParsedResultAssets({
  workspaceId,
  sourceId,
  job,
  client,
  blobStore = vercelBlobStore,
}: StoreParsedResultAssetsInput): Promise<StoredParsedResultAssets> {
  return Effect.runPromise(
    storeParsedResultAssetsEffect({
      workspaceId,
      sourceId,
      job,
      client,
      blobStore,
    }),
  )
}

export async function createResultZipMultipartUploadPlan({
  workspaceId,
  sourceId,
  jobId,
  client,
  blobStore = vercelMultipartBlobStore,
  fetchResult = fetch,
  partSizeBytes = resultZipPartSizeBytes,
}: CreateResultZipMultipartUploadPlanInput): Promise<ResultZipMultipartUploadPlan> {
  const startedAt = Date.now()
  const job = await client.jobs.get(jobId)
  const resultUrl = requireJobResultUrl(job, jobId)
  const sizeBytes = await getResultZipSize(resultUrl, fetchResult)
  const pathname = `${getParsedResultBlobPrefix(workspaceId, sourceId)}/result.zip`
  const upload = await withTimeout(
    "Create result ZIP multipart upload",
    resultZipBlobOperationTimeoutMs,
    blobStore.createMultipartUpload(pathname, getResultZipBlobOptions()),
  )

  const uploadPlan: ResultZipMultipartUploadPlan = {
    pathname,
    key: upload.key,
    uploadId: upload.uploadId,
    sizeBytes,
    partSizeBytes,
    partCount: Math.max(1, Math.ceil(sizeBytes / partSizeBytes)),
  }
  logger.info("parsed-result-assets: result ZIP upload plan created", {
    workspaceId,
    sourceId,
    jobId,
    sizeBytes,
    partCount: uploadPlan.partCount,
    durationMs: Date.now() - startedAt,
  })
  return uploadPlan
}

export function getResultZipPartRange(
  partNumber: number,
  partSizeBytes: number,
  sizeBytes: number,
): ResultZipPartRange {
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    throw new Error(`Invalid result ZIP part number: ${partNumber}.`)
  }
  if (!Number.isInteger(partSizeBytes) || partSizeBytes <= 0) {
    throw new Error(`Invalid result ZIP part size: ${partSizeBytes}.`)
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`Invalid result ZIP size: ${sizeBytes}.`)
  }

  const startByte = (partNumber - 1) * partSizeBytes
  if (startByte >= sizeBytes) {
    throw new Error(
      `Result ZIP part ${partNumber} starts beyond ${sizeBytes} bytes.`,
    )
  }

  return {
    startByte,
    endByte: Math.min(sizeBytes - 1, startByte + partSizeBytes - 1),
  }
}

export async function uploadResultZipPart({
  pathname,
  key,
  uploadId,
  partNumber,
  jobId,
  startByte,
  endByte,
  client,
  blobStore = vercelMultipartBlobStore,
  fetchResult = fetch,
}: UploadResultZipPartInput): Promise<MultipartUploadPart> {
  const startedAt = Date.now()
  const job = await client.jobs.get(jobId)
  const resultUrl = requireJobResultUrl(job, jobId)
  const body = await fetchResultZipRange({
    resultUrl,
    startByte,
    endByte,
    fetchResult,
  })

  const part = await withTimeout(
    `Upload result ZIP part ${partNumber}`,
    resultZipBlobOperationTimeoutMs,
    blobStore.uploadPart(pathname, body, {
      ...getResultZipBlobOptions(),
      key,
      uploadId,
      partNumber,
    }),
  )
  logger.info("parsed-result-assets: result ZIP part uploaded", {
    jobId,
    partNumber,
    startByte,
    endByte,
    byteLength: body.byteLength,
    durationMs: Date.now() - startedAt,
  })
  return part
}

export async function completeResultZipMultipartUpload({
  pathname,
  key,
  uploadId,
  parts,
  blobStore = vercelMultipartBlobStore,
}: CompleteResultZipMultipartUploadInput): Promise<{ readonly url: string }> {
  const startedAt = Date.now()
  const result = await withTimeout(
    "Complete result ZIP multipart upload",
    resultZipBlobOperationTimeoutMs,
    blobStore.completeMultipartUpload(
      pathname,
      [...parts].sort((a, b) => a.partNumber - b.partNumber),
      {
        ...getResultZipBlobOptions(),
        key,
        uploadId,
      },
    ),
  )
  logger.info("parsed-result-assets: result ZIP multipart upload completed", {
    partCount: parts.length,
    durationMs: Date.now() - startedAt,
  })
  return result
}

export async function prepareParsedResultAssetBatch(
  input: PrepareParsedResultAssetBatchInput,
): Promise<PrepareParsedResultAssetBatchResult> {
  return Effect.runPromise(prepareParsedResultAssetBatchEffect(input))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getParsedResultBlobPrefix(
  workspaceId: string,
  sourceId: string,
): string {
  return `workspaces/${workspaceId}/sources/${sourceId}/${parsedResultDirectoryName}`
}

function getBlobPutOptions(contentType: string) {
  return {
    access: "public" as const,
    allowOverwrite: true,
    contentType,
    multipart: true,
  }
}

function getResultZipBlobOptions(): ResultZipBlobOptions {
  return {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/zip",
  }
}

function getUploadableParsedAssets(
  parseResult: ParsedResultWithAssets,
): readonly ParsedAssetUpload[] {
  const assets: ParsedAssetUpload[] = []

  for (const image of parseResult.imageChunks ?? []) {
    const filePath = normalizeParsedAssetPath(image.filePath)
    if (!filePath || !image.data) continue

    assets.push({
      filePath,
      body: image.data,
      contentType: getContentTypeForPath(filePath),
    })
  }

  for (const table of parseResult.tableChunks ?? []) {
    const filePath = normalizeParsedAssetPath(table.filePath)
    if (!filePath || typeof table.html !== "string") continue

    assets.push({
      filePath,
      body: table.html,
      contentType: "text/html; charset=utf-8",
    })
  }

  return assets
}

async function getIndexedAssetCompletion(input: {
  readonly documentId?: string
  readonly existingAssetUrls: Readonly<Record<string, string>>
  readonly client: PrepareParsedResultAssetBatchInput["client"]
}): Promise<ParsedAssetIndexCompletion | null> {
  if (!input.documentId || !input.client.documents) return null

  const indexedAssetPaths = await listIndexedAssetPaths(
    input.client.documents,
    input.documentId,
  )
  const missingCount = indexedAssetPaths.filter(
    (filePath) => input.existingAssetUrls[filePath] === undefined,
  ).length
  if (missingCount > 0) return { kind: "missing", missingCount }

  return {
    kind: "complete",
    assetCount: indexedAssetPaths.length,
  }
}

async function listIndexedAssetPaths(
  documents: NonNullable<PrepareParsedResultAssetBatchInput["client"]["documents"]>,
  documentId: string,
): Promise<readonly string[]> {
  const [imagePaths, tablePaths] = await Promise.all([
    listIndexedAssetPathsByType(documents, documentId, "image"),
    listIndexedAssetPathsByType(documents, documentId, "table"),
  ])

  return [...new Set([...imagePaths, ...tablePaths])]
}

async function listIndexedAssetPathsByType(
  documents: NonNullable<PrepareParsedResultAssetBatchInput["client"]["documents"]>,
  documentId: string,
  chunkType: ParsedAssetChunkType,
): Promise<readonly string[]> {
  const paths: string[] = []
  let page = 1
  let totalPages = 1

  do {
    const response = await documents.listChunks(documentId, {
      page,
      pageSize: parsedAssetChunkPageSize,
      chunkType,
      includeAssetUrls: false,
    })

    for (const chunk of response.chunks) {
      const filePath = normalizeParsedAssetPath(
        getFirstString([
          chunk.filePath,
          chunk.metadata["filePath"],
          chunk.metadata["file_path"],
          chunk.sourceChunkPath,
        ]),
      )
      if (filePath) paths.push(filePath)
    }

    totalPages = getSafeTotalPages(response.pagination?.totalPages)
    page += 1
  } while (page <= totalPages)

  return paths
}

function normalizeParsedAssetPath(value: string | undefined): string | null {
  if (!value) return null
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "")
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("\0")
  ) {
    return null
  }

  const parts = normalized.split("/")
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    return null
  }

  const [directory] = parts
  if (directory !== "images" && directory !== "tables") return null
  return parts.join("/")
}

function getFirstString(values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string")
}

function getSafeTotalPages(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 1
}

function getContentTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".gif") return "image/gif"
  if (extension === ".webp") return "image/webp"
  if (extension === ".svg") return "image/svg+xml"
  return "application/octet-stream"
}

async function getResultZipSize(
  resultUrl: string,
  fetchResult: ResultZipFetch,
): Promise<number> {
  const headResponse = await fetchWithTimeout({
    description: "Knowhere result ZIP HEAD request",
    input: resultUrl,
    init: { method: "HEAD" },
    timeoutMs: resultZipMetadataTimeoutMs,
    fetchResult,
  })
  if (headResponse.ok) {
    const contentLength = getPositiveIntegerHeader(
      headResponse.headers,
      "content-length",
    )
    if (contentLength !== null) return contentLength
  }

  const rangeResponse = await fetchWithTimeout({
    description: "Knowhere result ZIP size range request",
    input: resultUrl,
    init: {
      headers: {
        Range: "bytes=0-0",
      },
    },
    timeoutMs: resultZipMetadataTimeoutMs,
    fetchResult,
  })
  await rangeResponse.body?.cancel()

  const contentRange = rangeResponse.headers.get("content-range")
  const rangeSize = parseContentRangeSize(contentRange)
  if (rangeSize !== null) return rangeSize

  if (rangeResponse.ok) {
    const contentLength = getPositiveIntegerHeader(
      rangeResponse.headers,
      "content-length",
    )
    if (contentLength !== null) return contentLength
  }

  throw new Error("Unable to determine Knowhere result ZIP size.")
}

async function fetchResultZipRange(input: {
  readonly resultUrl: string
  readonly startByte: number
  readonly endByte: number
  readonly fetchResult: ResultZipFetch
}): Promise<Buffer> {
  const expectedByteLength = input.endByte - input.startByte + 1
  const response = await fetchWithTimeout({
    description: "Knowhere result ZIP range fetch",
    input: input.resultUrl,
    init: {
      headers: {
        Range: `bytes=${input.startByte}-${input.endByte}`,
      },
    },
    timeoutMs: resultZipRangeFetchTimeoutMs,
    fetchResult: input.fetchResult,
  })

  if (!response.ok) {
    throw new Error(
      `Knowhere result ZIP range fetch failed with ${response.status}.`,
    )
  }
  if (response.status !== 206 && input.startByte !== 0) {
    throw new Error("Knowhere result ZIP server ignored a non-initial range.")
  }

  const body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength !== expectedByteLength) {
    throw new Error(
      `Knowhere result ZIP range returned ${body.byteLength} bytes, expected ${expectedByteLength}.`,
    )
  }
  return body
}

async function fetchWithTimeout(input: {
  readonly description: string
  readonly input: string | URL
  readonly init?: RequestInit
  readonly timeoutMs: number
  readonly fetchResult: ResultZipFetch
}): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`${input.description} timed out.`))
  }, input.timeoutMs)

  try {
    return await input.fetchResult(input.input, {
      ...input.init,
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `${input.description} timed out after ${input.timeoutMs}ms.`,
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function withTimeout<T>(
  description: string,
  timeoutMs: number,
  promise: Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${description} timed out after ${timeoutMs}ms.`))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timeoutId)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

function getPositiveIntegerHeader(
  headers: Headers,
  name: string,
): number | null {
  const value = headers.get(name)
  if (!value) return null

  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parseContentRangeSize(value: string | null): number | null {
  if (!value) return null

  const match = /^bytes\s+\d+-\d+\/(\d+)$/iu.exec(value.trim())
  if (!match) return null

  const parsed = Number.parseInt(match[1] ?? "", 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function requireJobResultUrl(
  job: Pick<JobResult, "resultUrl">,
  jobId: string,
): string {
  if (typeof job.resultUrl === "string" && job.resultUrl.length > 0) {
    return job.resultUrl
  }
  throw new Error(`Knowhere job ${jobId} does not expose a result ZIP URL.`)
}

const vercelBlobStore: ParsedResultBlobStore = {
  put: (pathname, body, options) =>
    put(pathname, body, {
      access: options.access ?? "public",
      allowOverwrite: options.allowOverwrite,
      contentType: options.contentType,
      multipart: options.multipart,
    }),
}

const vercelMultipartBlobStore: ResultZipMultipartBlobStore = {
  createMultipartUpload: (pathname, options) =>
    createVercelMultipartUpload(pathname, options),
  uploadPart: (pathname, body, options) =>
    uploadVercelPart(pathname, body, options),
  completeMultipartUpload: (pathname, parts, options) =>
    completeVercelMultipartUpload(pathname, [...parts], options),
}
