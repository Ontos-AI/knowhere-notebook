import { routeResult } from "@/lib/route-result"
import { getClientForWorkspace } from "./route-dependencies"
import type {
  ArchiveSourceBody,
  ArchiveSourceInput,
  JsonRouteResult,
  SourceRouteServiceDependencies,
} from "./route-types"

type RouteArchiveDependencies = Pick<
  SourceRouteServiceDependencies,
  | "deleteBlob"
  | "demoApi"
  | "ensureApiKeyForWorkspace"
  | "ensureWorkspace"
  | "makeKnowhereClient"
  | "requireUser"
  | "sourceService"
>

type RouteArchive = {
  readonly archiveSource: (
    input: ArchiveSourceInput,
  ) => Promise<JsonRouteResult<ArchiveSourceBody>>
}

function createRouteArchive(deps: RouteArchiveDependencies): RouteArchive {
  return {
    archiveSource: (input: ArchiveSourceInput) => archiveSource(input, deps),
  }
}

async function archiveSource(
  input: ArchiveSourceInput,
  deps: RouteArchiveDependencies,
): Promise<JsonRouteResult<ArchiveSourceBody>> {
  const user = await deps.requireUser()
  const workspace = await deps.ensureWorkspace(user.id)
  const source = await deps.sourceService.findInWorkspace(
    workspace.id,
    input.sourceId,
  )

  if (!source) {
    const catalog = await deps.demoApi.fetchCatalog()
    const isDemoSource = catalog.sources.some(
      (candidate) => candidate.demoSourceId === input.sourceId,
    )
    if (isDemoSource) {
      await deps.sourceService.hideDemoSource(workspace.id, input.sourceId)
      return routeResult.ok({ id: input.sourceId, archived: true })
    }

    return routeResult.error(404, "Source not found.")
  }

  if (source.knowhereDocumentId) {
    const client = await getClientForWorkspace(
      workspace.id,
      input.cookieHeader,
      deps,
    )
    await client.documents.archive(source.knowhereDocumentId)
  }

  await deps.sourceService.softDelete(workspace.id, input.sourceId)
  if (source.demoKey) {
    await deps.sourceService.hideDemoSource(workspace.id, source.demoKey)
  }
  if (source.originalBlobPathname) {
    try {
      await deps.deleteBlob(source.originalBlobPathname)
    } catch {
      // Source archival already succeeded; Blob cleanup is best-effort.
    }
  }

  return routeResult.ok({ id: input.sourceId, archived: true })
}

export { createRouteArchive }
