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
  | "demoData"
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
    return routeResult.error(404, "Source not found.")
  }

  const isDemoSource = Boolean(
    source.demoKey && deps.demoData.getSourceSeedByDemoKey(source.demoKey),
  )

  if (!isDemoSource && source.knowhereDocumentId) {
    const client = await getClientForWorkspace(
      workspace.id,
      input.cookieHeader,
      deps,
    )
    await client.documents.archive(source.knowhereDocumentId)
  }

  await deps.sourceService.softDelete(workspace.id, input.sourceId)
  if (!isDemoSource && source.originalBlobPathname) {
    try {
      await deps.deleteBlob(source.originalBlobPathname)
    } catch {
      // Source archival already succeeded; Blob cleanup is best-effort.
    }
  }

  return routeResult.ok({ id: input.sourceId, archived: true })
}

export { createRouteArchive }
