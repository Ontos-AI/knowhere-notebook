import "server-only"

import { Buffer } from "node:buffer"
import {
  BlobNotFoundError,
  del,
  get,
  head,
  list,
  put,
  type GetBlobResult,
  type HeadBlobResult,
  type ListBlobResult,
  type PutBlobResult,
} from "@vercel/blob"
import type {
  KnowhereSdkStorage,
  KnowhereSdkStorageBody,
  KnowhereSdkStorageHead,
  KnowhereSdkStorageObject,
  KnowhereSdkStorageReadResult,
  KnowhereSdkStorageWriteResult,
} from "@ontos-ai/knowhere-sdk"

type VercelBlobBody = Buffer | Blob | ReadableStream<Uint8Array>

export type VercelBlobStore = {
  readonly put: (
    pathname: string,
    body: VercelBlobBody | string,
    options: {
      readonly access: "public"
      readonly addRandomSuffix: false
      readonly allowOverwrite: true
      readonly contentType?: string
    },
  ) => Promise<Pick<PutBlobResult, "pathname" | "url">>
  readonly head: (pathname: string) => Promise<HeadBlobResult>
  readonly get: (
    pathname: string,
    options: { readonly access: "public" },
  ) => Promise<GetBlobResult | null>
  readonly list: (options: {
    readonly prefix: string
    readonly limit: number
    readonly cursor?: string
  }) => Promise<ListBlobResult>
  readonly del: (pathname: string | readonly string[]) => Promise<void>
}

type StoredMetadataSidecar = {
  readonly metadata?: Readonly<Record<string, string>>
}

const metadataSuffix = ".metadata.json"
const deletePrefixPageSize = 1000

const vercelBlobStore: VercelBlobStore = {
  put,
  head,
  get,
  list,
  del: (pathname) =>
    del(typeof pathname === "string" ? pathname : [...pathname]),
}

class VercelBlobKnowhereSdkStorage implements KnowhereSdkStorage {
  private readonly blobStore: VercelBlobStore

  constructor(blobStore: VercelBlobStore = vercelBlobStore) {
    this.blobStore = blobStore
  }

  async headObject(key: string): Promise<KnowhereSdkStorageHead | null> {
    validateBlobStorageKey(key)

    try {
      const object = await this.blobStore.head(key)
      const metadata = await this.readMetadata(key)
      return {
        key,
        contentType: object.contentType,
        contentLength: object.size,
        metadata,
      }
    } catch (error) {
      if (isBlobNotFoundError(error)) return null
      throw error
    }
  }

  async writeObject(
    input: KnowhereSdkStorageObject,
  ): Promise<KnowhereSdkStorageWriteResult> {
    validateBlobStorageKey(input.key)

    const object = await this.blobStore.put(
      input.key,
      toVercelBlobBody(input.body),
      {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: input.contentType,
      },
    )
    await this.writeMetadata(input.key, input.metadata ?? {})

    return {
      key: object.pathname,
      url: object.url,
    }
  }

  async getObjectUrl(key: string): Promise<string | null> {
    validateBlobStorageKey(key)

    try {
      const object = await this.blobStore.head(key)
      return object.url
    } catch (error) {
      if (isBlobNotFoundError(error)) return null
      throw error
    }
  }

  async readObject(key: string): Promise<KnowhereSdkStorageReadResult | null> {
    validateBlobStorageKey(key)

    const object = await this.blobStore.get(key, { access: "public" })
    if (!object || object.statusCode !== 200) return null

    return {
      body: await readStream(object.stream),
      contentType: object.blob.contentType,
      metadata: await this.readMetadata(key),
    }
  }

  async deleteObject(key: string): Promise<void> {
    validateBlobStorageKey(key)
    await this.deleteIgnoringMissing([key, getMetadataKey(key)])
  }

  async deletePrefix(prefix: string): Promise<void> {
    validateBlobStoragePrefix(prefix)
    const blobPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`

    let cursor: string | undefined
    do {
      const page = await this.blobStore.list({
        prefix: blobPrefix,
        limit: deletePrefixPageSize,
        ...(cursor ? { cursor } : {}),
      })
      const pathnames = page.blobs.map((blob) => blob.pathname)
      if (pathnames.length > 0) await this.deleteIgnoringMissing(pathnames)
      cursor = page.cursor
      if (page.hasMore && !cursor) break
    } while (cursor)
  }

  private async readMetadata(
    key: string,
  ): Promise<Readonly<Record<string, string>>> {
    const metadataObject = await this.blobStore.get(getMetadataKey(key), {
      access: "public",
    })
    if (!metadataObject || metadataObject.statusCode !== 200) return {}

    const body = await readStream(metadataObject.stream)
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
    return parseStoredMetadataSidecar(parsed).metadata ?? {}
  }

  private async writeMetadata(
    key: string,
    metadata: Readonly<Record<string, string>>,
  ): Promise<void> {
    const sidecar: StoredMetadataSidecar = { metadata }
    await this.blobStore.put(
      getMetadataKey(key),
      JSON.stringify(sidecar, null, 2),
      {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      },
    )
  }

  private async deleteIgnoringMissing(
    pathnames: readonly string[],
  ): Promise<void> {
    try {
      await this.blobStore.del(pathnames)
    } catch (error) {
      if (!isBlobNotFoundError(error)) throw error
    }
  }
}

export function createVercelBlobKnowhereSdkStorage(
  blobStore?: VercelBlobStore,
): KnowhereSdkStorage {
  return new VercelBlobKnowhereSdkStorage(blobStore)
}

function validateBlobStorageKey(key: string): void {
  if (!isSafeRelativePosixPath(key)) {
    throw new Error(`Invalid Knowhere SDK storage key: ${key}`)
  }
}

function validateBlobStoragePrefix(prefix: string): void {
  const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix
  if (!isSafeRelativePosixPath(normalizedPrefix)) {
    throw new Error(`Invalid Knowhere SDK storage prefix: ${prefix}`)
  }
}

function isSafeRelativePosixPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return false
  }

  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function getMetadataKey(key: string): string {
  return `${key}${metadataSuffix}`
}

function toVercelBlobBody(body: KnowhereSdkStorageBody): VercelBlobBody {
  if (body instanceof Uint8Array) return Buffer.from(body)
  return body
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
      totalLength += result.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function parseStoredMetadataSidecar(value: unknown): StoredMetadataSidecar {
  if (!isRecord(value)) return {}
  const metadata = value.metadata
  if (!isRecord(metadata)) return {}

  return {
    metadata: Object.fromEntries(
      Object.entries(metadata).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isBlobNotFoundError(error: unknown): boolean {
  return error instanceof BlobNotFoundError
}
