import "server-only"

import { head, put, BlobNotFoundError } from "@vercel/blob"
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

const parsedResultDirectoryName = "parsed-result"
const parsedResultAssetIndexFileName = "asset-index.json"

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
