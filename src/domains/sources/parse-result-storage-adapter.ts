import "server-only"

import { get, head, put, BlobNotFoundError } from "@vercel/blob"
import type {
  KnowhereAssetStorageObject,
  KnowhereAssetStorageOptions,
} from "@ontos-ai/knowhere-sdk"

export type ParsedResultAssetStorageInput = {
  readonly workspaceId: string
  readonly sourceId: string
}

export type ParsedResultAssetIndex = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
  readonly updatedAt: string
}

export type ParsedResultSnapshotChunk = {
  readonly id: string
  readonly chunkId: string
  readonly chunkType: string
  readonly contentSource?: string
  readonly content: string
  readonly sectionPath?: string
  readonly sourceChunkPath: string
  readonly filePath?: string
  readonly sortOrder: number
  readonly metadata: Record<string, unknown>
  readonly assetUrl?: string
}

export type ParsedResultSnapshotChunkPage = {
  readonly version: 1
  readonly jobId: string
  readonly documentId?: string
  readonly namespace?: string
  readonly sourceFileName: string
  readonly page: number
  readonly pageSize: number
  readonly total: number
  readonly totalPages: number
  readonly chunks: readonly ParsedResultSnapshotChunk[]
}

export type ParsedResultSnapshotManifest = {
  readonly version: 1
  readonly kind: "knowhere-parsed-result-snapshot"
  readonly jobId: string
  readonly documentId?: string
  readonly namespace?: string
  readonly sourceFileName: string
  readonly totalChunks: number
  readonly chunkPageSize: number
  readonly chunkPages: readonly {
    readonly page: number
    readonly pageSize: number
    readonly chunkCount: number
    readonly key: string
    readonly url?: string
  }[]
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
  readonly createdAt: string
}

const parsedResultDirectoryName = "parsed-result"
const parsedResultAssetIndexFileName = "asset-index.json"
const parsedResultSnapshotManifestPath = "manifest/current.json"

export function createParsedResultStorageAdapter({
  workspaceId,
  sourceId,
}: ParsedResultAssetStorageInput): KnowhereAssetStorageOptions {
  return {
    adapter: {
      async headObject(key) {
        try {
          const blob = await head(key)
          return {
            key,
            contentType: blob.contentType,
            contentLength: blob.size,
            url: blob.url,
          }
        } catch (error) {
          if (error instanceof BlobNotFoundError) return null
          throw error
        }
      },
      async getObjectUrl(key) {
        try {
          return (await head(key)).url
        } catch (error) {
          if (error instanceof BlobNotFoundError) return null
          throw error
        }
      },
      async writeObject(input: KnowhereAssetStorageObject) {
        const blob = await put(input.key, Buffer.from(input.body), {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: input.contentType,
          multipart: true,
        })

        return {
          key: blob.pathname,
          url: blob.url,
        }
      },
    },
    keyPrefix: getParsedResultBlobPrefix(workspaceId, sourceId),
    skipExisting: true,
  }
}

export function getParsedResultSnapshotManifestKey({
  workspaceId,
  sourceId,
}: ParsedResultAssetStorageInput): string {
  return `${getParsedResultBlobPrefix(
    workspaceId,
    sourceId,
  )}/${parsedResultSnapshotManifestPath}`
}

export async function readParsedResultSnapshotManifest(input: {
  readonly workspaceId: string
  readonly sourceId: string
  readonly manifestKey?: string | null
  readonly blobStore?: ParsedResultSnapshotBlobStore
}): Promise<ParsedResultSnapshotManifest | null> {
  const key =
    input.manifestKey ??
    getParsedResultSnapshotManifestKey({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
    })
  const text = await readBlobText(key, input.blobStore ?? vercelSnapshotBlobStore)
  if (!text) return null
  return parseSnapshotManifest(text)
}

export async function readParsedResultSnapshotChunkPage(input: {
  readonly pageKey: string
  readonly blobStore?: ParsedResultSnapshotBlobStore
}): Promise<ParsedResultSnapshotChunkPage | null> {
  const text = await readBlobText(input.pageKey, input.blobStore ?? vercelSnapshotBlobStore)
  if (!text) return null
  return parseSnapshotChunkPage(text)
}

export async function writeParsedResultAssetIndex(input: {
  readonly workspaceId: string
  readonly sourceId: string
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}): Promise<string> {
  const index: ParsedResultAssetIndex = {
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    assetUrlsByFilePath: input.assetUrlsByFilePath,
    updatedAt: new Date().toISOString(),
  }
  const pathname = `${getParsedResultBlobPrefix(
    input.workspaceId,
    input.sourceId,
  )}/${parsedResultAssetIndexFileName}`
  const blob = await put(pathname, JSON.stringify(index, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  })

  return blob.url
}

function getParsedResultBlobPrefix(workspaceId: string, sourceId: string): string {
  return `workspaces/${workspaceId}/sources/${sourceId}/${parsedResultDirectoryName}`
}

type ParsedResultSnapshotBlobGetResult =
  | {
      readonly statusCode: 200
      readonly stream: ReadableStream<Uint8Array>
    }
  | {
      readonly statusCode: 304
      readonly stream: null
    }

export type ParsedResultSnapshotBlobStore = {
  readonly get: (
    pathname: string,
    options: { readonly access: "public" },
  ) => Promise<ParsedResultSnapshotBlobGetResult | null>
}

const vercelSnapshotBlobStore: ParsedResultSnapshotBlobStore = {
  get: (pathname, options) => get(pathname, options),
}

async function readBlobText(
  key: string,
  blobStore: ParsedResultSnapshotBlobStore,
): Promise<string | null> {
  try {
    const result = await blobStore.get(key, { access: "public" })
    if (!result || result.statusCode !== 200) return null
    return new Response(result.stream).text()
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null
    throw error
  }
}

function parseSnapshotManifest(text: string): ParsedResultSnapshotManifest | null {
  try {
    const value: unknown = JSON.parse(text)
    return isSnapshotManifest(value) ? value : null
  } catch {
    return null
  }
}

function parseSnapshotChunkPage(text: string): ParsedResultSnapshotChunkPage | null {
  try {
    const value: unknown = JSON.parse(text)
    return isSnapshotChunkPage(value) ? value : null
  } catch {
    return null
  }
}

function isSnapshotManifest(value: unknown): value is ParsedResultSnapshotManifest {
  if (!isRecord(value)) return false
  return (
    value["kind"] === "knowhere-parsed-result-snapshot" &&
    value["version"] === 1 &&
    typeof value["jobId"] === "string" &&
    typeof value["sourceFileName"] === "string" &&
    typeof value["totalChunks"] === "number" &&
    typeof value["chunkPageSize"] === "number" &&
    Array.isArray(value["chunkPages"]) &&
    isRecord(value["assetUrlsByFilePath"]) &&
    typeof value["createdAt"] === "string"
  )
}

function isSnapshotChunkPage(value: unknown): value is ParsedResultSnapshotChunkPage {
  if (!isRecord(value)) return false
  return (
    value["version"] === 1 &&
    typeof value["jobId"] === "string" &&
    typeof value["sourceFileName"] === "string" &&
    typeof value["page"] === "number" &&
    typeof value["pageSize"] === "number" &&
    typeof value["total"] === "number" &&
    typeof value["totalPages"] === "number" &&
    Array.isArray(value["chunks"])
  )
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
