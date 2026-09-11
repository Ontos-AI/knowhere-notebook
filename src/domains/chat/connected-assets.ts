import type { Documents } from "@ontos-ai/knowhere-sdk"

import type {
  ConnectedAssetLookup,
  ResolveConnectedAssets,
  ResolvedConnectedAsset,
} from "@/agent-harness"

const documentChunkApiMaximumPageSize = 200

type DocumentChunkReader = Pick<Documents, "listChunks">

export function createConnectedAssetResolver(
  documents: DocumentChunkReader,
): ResolveConnectedAssets {
  return (lookups) => resolveConnectedAssets(documents, lookups)
}

async function resolveConnectedAssets(
  documents: DocumentChunkReader,
  lookups: readonly ConnectedAssetLookup[],
): Promise<readonly ResolvedConnectedAsset[]> {
  const lookupGroups = groupLookups(lookups)
  const resolvedGroups = await Promise.all(
    [...lookupGroups.values()].map((group) =>
      resolveLookupGroup(documents, group),
    ),
  )
  const assetUrlByLookup = new Map(
    resolvedGroups.flatMap((group) =>
      group.map((asset) => [lookupKey(asset), asset.assetUrl] as const),
    ),
  )

  return lookups.map((lookup) => {
    const assetUrl = assetUrlByLookup.get(lookupKey(lookup))
    if (!assetUrl) {
      throw new Error(
        `Connected ${lookup.type} chunk ${lookup.chunkId} was not found in document ${lookup.documentId}.`,
      )
    }
    return { ...lookup, assetUrl }
  })
}

function groupLookups(
  lookups: readonly ConnectedAssetLookup[],
): Map<string, ConnectedAssetLookup[]> {
  const groups = new Map<string, ConnectedAssetLookup[]>()
  for (const lookup of lookups) {
    const key = `${lookup.documentId}\u0000${lookup.type}`
    const group = groups.get(key) ?? []
    group.push(lookup)
    groups.set(key, group)
  }
  return groups
}

async function resolveLookupGroup(
  documents: DocumentChunkReader,
  lookups: readonly ConnectedAssetLookup[],
): Promise<readonly ResolvedConnectedAsset[]> {
  const first = lookups[0]
  if (!first) return []

  const remaining = new Set(lookups.map((lookup) => lookup.chunkId))
  const resolved: ResolvedConnectedAsset[] = []
  let page = 1
  let totalPages = page

  do {
    const response = await documents.listChunks(first.documentId, {
      page,
      pageSize: documentChunkApiMaximumPageSize,
      chunkType: first.type,
      includeAssetUrls: true,
    })
    totalPages = response.pagination.totalPages

    for (const chunk of response.chunks) {
      if (!remaining.has(chunk.chunkId)) continue
      const assetUrl = chunk.assetUrl?.trim()
      if (!assetUrl) {
        throw new Error(
          `Connected ${first.type} chunk ${chunk.chunkId} has no signed asset URL.`,
        )
      }
      resolved.push({
        documentId: first.documentId,
        chunkId: chunk.chunkId,
        type: first.type,
        assetUrl,
      })
      remaining.delete(chunk.chunkId)
    }

    page += 1
  } while (remaining.size > 0 && page <= totalPages)

  return resolved
}

function lookupKey(lookup: ConnectedAssetLookup): string {
  return `${lookup.documentId}\u0000${lookup.type}\u0000${lookup.chunkId}`
}
