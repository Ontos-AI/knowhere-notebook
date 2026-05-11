import "server-only"

import { createRouteArchive } from "./route-archive"
import { createRouteChunks } from "./route-chunks"
import { createSourceRouteDependencies } from "./route-dependencies"
import { createRouteListing } from "./route-listing"
import { createRouteUpload } from "./route-upload"
import type {
  ArchiveSourceInput,
  ListSourcesInput,
  LoadSourceChunksInput,
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
  const chunks = createRouteChunks(deps)

  return {
    listSources: (input: ListSourcesInput) => listing.listSources(input),
    uploadSource: (input: UploadSourceInput) => upload.uploadSource(input),
    archiveSource: (input: ArchiveSourceInput) => archive.archiveSource(input),
    loadSourceChunks: (input: LoadSourceChunksInput) =>
      chunks.loadSourceChunks(input),
  }
}
