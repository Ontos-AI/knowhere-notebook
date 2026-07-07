import "server-only"

import { del, get, head, put, BlobNotFoundError } from "@vercel/blob"
import type {
  KnowhereParsedSnapshotChunkPage,
  KnowhereParsedSnapshotManifest,
  ParsedDocumentStorage,
  ParsedDocumentStorageAsset,
  ParsedDocumentStorageAssetParams,
  ParsedDocumentStorageChunkPageParams,
  ParsedDocumentStorageDocument,
  ParsedDocumentStorageManifestParams,
  ParsedDocumentSyncProgress,
} from "@ontos-ai/knowhere-sdk"

/**
 * Vercel Blob backed implementation of the SDK `ParsedDocumentStorage`
 * interface. The SDK only ever calls this with `{ documentId, revisionKey }`,
 * so the adapter is constructed with the enclosing workspace and derives all
 * blob keys from documentId + revisionKey. Keying every artifact under the
 * revision key gives the SDK freshness contract for free: a manifest read at a
 * revision path always carries a matching `revisionKey`.
 *
 * The `blobStore` seam mirrors the pattern used elsewhere in the sources
 * domain so tests can inject a fake store instead of hitting Vercel Blob.
 */

const parsedDocumentsDirectoryName = "parsed-documents"
const manifestStoragePath = "manifest.json"
const legacyManifestStoragePath = "manifest/current.json"
const syncProgressStoragePath = "sync-progress.json"
const jsonContentType = "application/json; charset=utf-8"
const binaryContentType = "application/octet-stream"

type BlobGetResult =
  | {
      readonly statusCode: 200
      readonly stream: ReadableStream<Uint8Array>
      readonly contentType?: string
    }
  | {
      readonly statusCode: 304
      readonly stream: null
    }

type BlobPutResult = {
  readonly url: string
  readonly pathname: string
}

type BlobHeadResult = {
  readonly url: string
}

/**
 * Minimal blob operations the adapter depends on. The default binds directly to
 * `@vercel/blob`; tests provide an in-memory stand-in.
 */
export type ParsedDocumentBlobStore = {
  readonly get: (
    pathname: string,
    options: { readonly access: "public" },
  ) => Promise<BlobGetResult | null>
  readonly put: (
    pathname: string,
    body: string | Buffer,
    options: {
      readonly access: "public"
      readonly allowOverwrite: boolean
      readonly contentType: string
      readonly multipart?: boolean
    },
  ) => Promise<BlobPutResult>
  readonly head: (pathname: string) => Promise<BlobHeadResult | null>
  readonly del: (pathname: string) => Promise<void>
}

export type BlobParsedDocumentStorageInput = {
  readonly workspaceId: string
  readonly blobStore?: ParsedDocumentBlobStore
}

export type ParsedDocumentStorageObject = ParsedDocumentStorageDocument & {
  readonly path: string
}

export type ParsedDocumentStorageWritableObject =
  ParsedDocumentStorageObject & {
    readonly body: string | Buffer | Uint8Array
    readonly contentType?: string
  }

export type ParsedDocumentStorageReadableObject = {
  readonly body: Buffer
  readonly contentType?: string
}

const vercelBlobStore: ParsedDocumentBlobStore = {
  get: async (pathname, options) => {
    const blob = await get(pathname, options)
    if (!blob) return null
    if (blob.statusCode === 304) {
      return { statusCode: 304, stream: null }
    }
    return {
      statusCode: 200,
      stream: blob.stream,
      contentType: blob.blob.contentType,
    }
  },
  put: async (pathname, body, options) => {
    const blob = await put(pathname, body, {
      access: options.access,
      addRandomSuffix: false,
      allowOverwrite: options.allowOverwrite,
      contentType: options.contentType,
      multipart: options.multipart,
    })
    return { url: blob.url, pathname: blob.pathname }
  },
  head: async (pathname) => {
    try {
      const blob = await head(pathname)
      return { url: blob.url }
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null
      throw error
    }
  },
  del: (pathname) => del(pathname),
}

export class BlobParsedDocumentStorage implements ParsedDocumentStorage {
  private readonly workspaceId: string
  private readonly blobStore: ParsedDocumentBlobStore

  constructor(input: BlobParsedDocumentStorageInput) {
    this.workspaceId = input.workspaceId
    this.blobStore = input.blobStore ?? vercelBlobStore
  }

  async readManifest(
    params: ParsedDocumentStorageManifestParams,
  ): Promise<KnowhereParsedSnapshotManifest | null> {
    const current = await this.readJson<KnowhereParsedSnapshotManifest>(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: manifestStoragePath,
      }),
    )
    if (current) return current

    return this.readJson<KnowhereParsedSnapshotManifest>(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: legacyManifestStoragePath,
      }),
    )
  }

  async writeManifest(params: {
    readonly documentId: string
    readonly revisionKey: string
    readonly manifest: KnowhereParsedSnapshotManifest
  }): Promise<void> {
    await this.writeJson(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: manifestStoragePath,
      }),
      params.manifest,
    )
  }

  async readChunkPage(
    params: ParsedDocumentStorageChunkPageParams,
  ): Promise<KnowhereParsedSnapshotChunkPage | null> {
    // chunkType filtering happens SDK-side after read; storage returns the full page.
    return this.readJson<KnowhereParsedSnapshotChunkPage>(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: getChunkPageStoragePath(params.page),
      }),
    )
  }

  async writeChunkPage(params: {
    readonly documentId: string
    readonly revisionKey: string
    readonly page: KnowhereParsedSnapshotChunkPage
  }): Promise<void> {
    await this.writeJson(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: getChunkPageStoragePath(params.page.page),
      }),
      params.page,
    )
  }

  async writeAsset(
    params: ParsedDocumentStorageDocument & ParsedDocumentStorageAsset,
  ): Promise<{ readonly sourcePath: string; readonly url?: string }> {
    const blob = await this.blobStore.put(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: params.sourcePath,
      }),
      Buffer.from(params.body),
      {
        access: "public",
        allowOverwrite: true,
        contentType: params.contentType,
        multipart: true,
      },
    )
    return { sourcePath: params.sourcePath, url: blob.url }
  }

  async getAssetUrl(
    params: ParsedDocumentStorageAssetParams,
  ): Promise<string | null> {
    const result = await this.blobStore.head(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: params.sourcePath,
      }),
    )
    if (result) return result.url

    const legacyResult = await this.blobStore.head(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: `assets/${params.sourcePath}`,
      }),
    )
    return legacyResult?.url ?? null
  }

  async readSyncProgress(
    params: ParsedDocumentStorageDocument,
  ): Promise<ParsedDocumentSyncProgress | null> {
    return this.readJson<ParsedDocumentSyncProgress>(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: syncProgressStoragePath,
      }),
    )
  }

  async writeSyncProgress(params: ParsedDocumentSyncProgress): Promise<void> {
    await this.writeJson(
      this.getObjectKey({
        documentId: params.documentId,
        revisionKey: params.revisionKey,
        path: syncProgressStoragePath,
      }),
      params,
    )
  }

  async readObject(
    params: ParsedDocumentStorageObject,
  ): Promise<ParsedDocumentStorageReadableObject | null> {
    return this.readBlobObject(this.getObjectKey(params))
  }

  async writeObject(
    params: ParsedDocumentStorageWritableObject,
  ): Promise<{ readonly path: string; readonly url?: string }> {
    const blob = await this.blobStore.put(
      this.getObjectKey(params),
      Buffer.from(params.body),
      {
        access: "public",
        allowOverwrite: true,
        contentType: params.contentType ?? binaryContentType,
        multipart: true,
      },
    )
    return { path: params.path, url: blob.url }
  }

  async getObjectUrl(
    params: ParsedDocumentStorageObject,
  ): Promise<string | null> {
    const result = await this.blobStore.head(this.getObjectKey(params))
    return result?.url ?? null
  }

  async deleteObject(params: ParsedDocumentStorageObject): Promise<void> {
    await this.blobStore.del(this.getObjectKey(params))
  }

  private getRevisionPrefix(documentId: string, revisionKey: string): string {
    return [
      "workspaces",
      normalizePathSegment(this.workspaceId),
      parsedDocumentsDirectoryName,
      normalizePathSegment(documentId),
      normalizePathSegment(revisionKey),
    ].join("/")
  }

  private getObjectKey(params: ParsedDocumentStorageObject): string {
    return `${this.getRevisionPrefix(params.documentId, params.revisionKey)}/${normalizeRelativeStoragePath(params.path)}`
  }

  private async readJson<T>(key: string): Promise<T | null> {
    const text = await this.readBlobText(key)
    if (text === null) return null
    try {
      return JSON.parse(text) as T
    } catch {
      return null
    }
  }

  private async writeJson(key: string, value: unknown): Promise<void> {
    await this.blobStore.put(key, JSON.stringify(value), {
      access: "public",
      allowOverwrite: true,
      contentType: jsonContentType,
    })
  }

  private async readBlobText(key: string): Promise<string | null> {
    const object = await this.readBlobObject(key)
    return object ? object.body.toString("utf8") : null
  }

  private async readBlobObject(
    key: string,
  ): Promise<ParsedDocumentStorageReadableObject | null> {
    try {
      const result = await this.blobStore.get(key, { access: "public" })
      if (!result || result.statusCode !== 200) return null
      const body = Buffer.from(await new Response(result.stream).arrayBuffer())
      return {
        body,
        ...(result.contentType ? { contentType: result.contentType } : {}),
      }
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null
      throw error
    }
  }
}

function getChunkPageStoragePath(page: number): string {
  return `chunks/page-${page}.json`
}

/**
 * Reject path segments that could traverse outside the intended prefix. Mirrors
 * the SDK `DiskParsedDocumentStorage` guard so blob keys stay well-formed.
 */
function normalizePathSegment(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("/") ||
    value.includes("\\") ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`Invalid parsed storage segment: ${value}`)
  }
  return value
}

function normalizeRelativeStoragePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "")
  if (
    normalized.length === 0 ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized
      .split("/")
      .some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new Error(`Invalid parsed storage path: ${value}`)
  }
  return normalized
}
