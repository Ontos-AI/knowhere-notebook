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
  readonly resultBlobUrl: string
  readonly client: {
    readonly jobs: {
      load(jobId: string): Promise<unknown>
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
        blobStore.put(
          `${blobPrefix}/${asset.filePath}`,
          asset.body,
          getBlobPutOptions(asset.contentType),
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
  const job = await client.jobs.get(jobId)
  const resultUrl = requireJobResultUrl(job, jobId)
  const sizeBytes = await getResultZipSize(resultUrl, fetchResult)
  const pathname = `${getParsedResultBlobPrefix(workspaceId, sourceId)}/result.zip`
  const upload = await blobStore.createMultipartUpload(
    pathname,
    getResultZipBlobOptions(),
  )

  return {
    pathname,
    key: upload.key,
    uploadId: upload.uploadId,
    sizeBytes,
    partSizeBytes,
    partCount: Math.max(1, Math.ceil(sizeBytes / partSizeBytes)),
  }
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
  const job = await client.jobs.get(jobId)
  const resultUrl = requireJobResultUrl(job, jobId)
  const body = await fetchResultZipRange({
    resultUrl,
    startByte,
    endByte,
    fetchResult,
  })

  return blobStore.uploadPart(pathname, body, {
    ...getResultZipBlobOptions(),
    key,
    uploadId,
    partNumber,
  })
}

export async function completeResultZipMultipartUpload({
  pathname,
  key,
  uploadId,
  parts,
  blobStore = vercelMultipartBlobStore,
}: CompleteResultZipMultipartUploadInput): Promise<{ readonly url: string }> {
  return blobStore.completeMultipartUpload(
    pathname,
    [...parts].sort((a, b) => a.partNumber - b.partNumber),
    {
      ...getResultZipBlobOptions(),
      key,
      uploadId,
    },
  )
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
  const headResponse = await fetchResult(resultUrl, { method: "HEAD" })
  if (headResponse.ok) {
    const contentLength = getPositiveIntegerHeader(
      headResponse.headers,
      "content-length",
    )
    if (contentLength !== null) return contentLength
  }

  const rangeResponse = await fetchResult(resultUrl, {
    headers: {
      Range: "bytes=0-0",
    },
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
  const response = await input.fetchResult(input.resultUrl, {
    headers: {
      Range: `bytes=${input.startByte}-${input.endByte}`,
    },
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
