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
const manifestStoragePath = "manifest/current.json"
const syncProgressStoragePath = "sync-progress.json"
const jsonContentType = "application/json; charset=utf-8"

type BlobGetResult =
  | {
      readonly statusCode: 200
      readonly stream: ReadableStream<Uint8Array>
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

const vercelBlobStore: ParsedDocumentBlobStore = {
  get: (pathname, options) => get(pathname, options),
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
    return this.readJson<KnowhereParsedSnapshotManifest>(
      this.getManifestKey(params.documentId, params.revisionKey),
    )
  }

  async writeManifest(params: {
    readonly documentId: string
    readonly revisionKey: string
    readonly manifest: KnowhereParsedSnapshotManifest
  }): Promise<void> {
    await this.writeJson(
      this.getManifestKey(params.documentId, params.revisionKey),
      params.manifest,
    )
  }

  async readChunkPage(
    params: ParsedDocumentStorageChunkPageParams,
  ): Promise<KnowhereParsedSnapshotChunkPage | null> {
    // chunkType filtering happens SDK-side after read; storage returns the full page.
    return this.readJson<KnowhereParsedSnapshotChunkPage>(
      this.getChunkPageKey(params.documentId, params.revisionKey, params.page),
    )
  }

  async writeChunkPage(params: {
    readonly documentId: string
    readonly revisionKey: string
    readonly page: KnowhereParsedSnapshotChunkPage
  }): Promise<void> {
    await this.writeJson(
      this.getChunkPageKey(
        params.documentId,
        params.revisionKey,
        params.page.page,
      ),
      params.page,
    )
  }

  async writeAsset(
    params: ParsedDocumentStorageDocument & ParsedDocumentStorageAsset,
  ): Promise<{ readonly sourcePath: string; readonly url?: string }> {
    const blob = await this.blobStore.put(
      this.getAssetKey(params.documentId, params.revisionKey, params.sourcePath),
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
      this.getAssetKey(params.documentId, params.revisionKey, params.sourcePath),
    )
    return result?.url ?? null
  }

  async readSyncProgress(
    params: ParsedDocumentStorageDocument,
  ): Promise<ParsedDocumentSyncProgress | null> {
    return this.readJson<ParsedDocumentSyncProgress>(
      this.getSyncProgressKey(params.documentId, params.revisionKey),
    )
  }

  async writeSyncProgress(params: ParsedDocumentSyncProgress): Promise<void> {
    await this.writeJson(
      this.getSyncProgressKey(params.documentId, params.revisionKey),
      params,
    )
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

  private getManifestKey(documentId: string, revisionKey: string): string {
    return `${this.getRevisionPrefix(documentId, revisionKey)}/${manifestStoragePath}`
  }

  private getChunkPageKey(
    documentId: string,
    revisionKey: string,
    page: number,
  ): string {
    return `${this.getRevisionPrefix(documentId, revisionKey)}/chunks/page-${page}.json`
  }

  private getSyncProgressKey(documentId: string, revisionKey: string): string {
    return `${this.getRevisionPrefix(documentId, revisionKey)}/${syncProgressStoragePath}`
  }

  private getAssetKey(
    documentId: string,
    revisionKey: string,
    sourcePath: string,
  ): string {
    return `${this.getRevisionPrefix(documentId, revisionKey)}/assets/${normalizeRelativeStoragePath(sourcePath)}`
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
    try {
      const result = await this.blobStore.get(key, { access: "public" })
      if (!result || result.statusCode !== 200) return null
      return await new Response(result.stream).text()
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null
      throw error
    }
  }
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
