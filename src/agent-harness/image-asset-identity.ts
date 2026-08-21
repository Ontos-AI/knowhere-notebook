import type { EvidenceAsset, EvidenceChunk } from "./types"

export function getCanonicalImageAssetKey(
  asset: EvidenceAsset,
  chunksByRef: ReadonlyMap<string, EvidenceChunk>,
): string {
  const chunk = chunksByRef.get(asset.chunkRef)
  const documentId = getTrimmedValue(
    asset.source.documentId ?? chunk?.source.documentId,
  )
  const revisionKey = getTrimmedValue(asset.revisionKey ?? chunk?.revisionKey)
  const sourcePath = getTrimmedValue(asset.sourcePath)?.toLowerCase()

  if (documentId && revisionKey && sourcePath) {
    return `document:${documentId}\u0000${revisionKey}\u0000${sourcePath}`
  }

  const assetUrl = getNormalizedAssetUrl(asset.assetUrl)
  if (assetUrl) return `url:${assetUrl}`

  if (documentId && sourcePath) {
    return `document:${documentId}\u0000${sourcePath}`
  }

  return asset.ref
}

function getNormalizedAssetUrl(value: string | undefined): string | null {
  const trimmed = getTrimmedValue(value)
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    url.hash = ""
    return url.toString()
  } catch {
    return trimmed
  }
}

function getTrimmedValue(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
