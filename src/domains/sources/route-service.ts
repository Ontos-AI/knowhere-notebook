import "server-only"

import { createRouteArchive } from "./route-archive"
import { createRouteChunks } from "./route-chunks"
import { createSourceRouteDependencies } from "./route-dependencies"
import { createRouteListing } from "./route-listing"
import { createRoutePageAssets } from "./route-page-assets"
import { createRouteRetry } from "./route-retry"
import { createRouteUpload } from "./route-upload"
import type {
  ArchiveSourceInput,
  ListSourcesInput,
  LoadSourceChunksInput,
  LoadSourcePageAssetsInput,
  RetrySourceInput,
  SourceRouteService,
  SourceRouteServiceOverrides,
  UploadSourceInput,
} from "./route-types"

export function createSourceRouteService(
  overrides: SourceRouteServiceOverrides = {},
): SourceRouteService {
  const deps = createSourceRouteDependencies(overrides)
  const listing = createRouteListing(deps)
  const upload = createRouteUpload(deps)
  const archive = createRouteArchive(deps)
  const retry = createRouteRetry(deps)
  const chunks = createRouteChunks(deps)
  const pageAssets = createRoutePageAssets(deps)

  return {
    listSources: (input: ListSourcesInput) => listing.listSources(input),
    uploadSource: (input: UploadSourceInput) => upload.uploadSource(input),
    archiveSource: (input: ArchiveSourceInput) => archive.archiveSource(input),
    retrySource: (input: RetrySourceInput) => retry.retrySource(input),
    loadSourceChunks: (input: LoadSourceChunksInput) =>
      chunks.loadSourceChunks(input),
    loadSourcePageAssets: (input: LoadSourcePageAssetsInput) =>
      pageAssets.loadSourcePageAssets(input),
  }
}
