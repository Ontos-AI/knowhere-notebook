import "server-only"

import path from "node:path"
import { put } from "@vercel/blob"
import { Effect } from "effect"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

export type StoredParsedResultAssets = {
  resultBlobUrl: string
  assetUrlsByFilePath: Readonly<Record<string, string>>
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

const vercelBlobStore: ParsedResultBlobStore = {
  put: (pathname, body, options) =>
    put(pathname, body, {
      access: options.access ?? "public",
      allowOverwrite: options.allowOverwrite,
      contentType: options.contentType,
      multipart: options.multipart,
    }),
}
