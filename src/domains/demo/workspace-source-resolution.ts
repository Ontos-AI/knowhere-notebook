import type { Source } from "@/infrastructure/db/schema"
import type { DemoCatalog } from "@/integrations/knowhere-demo"

type WorkspaceDemoSourceResolution = {
  readonly materializedDemoSourceIds: ReadonlySet<string>
  readonly workspaceSources: readonly Source[]
}

type SourceViewOptions = {
  readonly chunkCount?: number
}

export function resolveWorkspaceDemoSources(
  sources: readonly Source[],
  catalog: DemoCatalog,
): WorkspaceDemoSourceResolution {
  const canonicalDocumentIdByDemoSourceId: Map<string, string> = new Map(
    catalog.sources.map((source) => [
      source.demoSourceId,
      source.canonicalDocumentId,
    ]),
  )
  const workspaceSources: Source[] = sources.filter(
    (source) =>
      !isLegacyCanonicalDemoSource(source, canonicalDocumentIdByDemoSourceId),
  )
  const materializedDemoSourceIds: Set<string> = new Set(
    workspaceSources.flatMap((source) => {
      if (!isMaterializedDemoSource(source, canonicalDocumentIdByDemoSourceId)) {
        return []
      }
      return source.demoKey ? [source.demoKey] : []
    }),
  )

  return {
    materializedDemoSourceIds,
    workspaceSources,
  }
}

export function getWorkspaceSourcesNeedingChunkCount(
  sources: readonly Source[],
): Source[] {
  return sources.filter((source) => !source.demoKey)
}

export function getMaterializedDemoSourceViewOptionsBySourceId(
  sources: readonly Source[],
  catalog: DemoCatalog,
): ReadonlyMap<string, SourceViewOptions> {
  const chunkCountByDemoSourceId: ReadonlyMap<string, number> = new Map(
    catalog.sources.map((source) => [source.demoSourceId, source.chunkCount]),
  )

  return new Map(
    sources.flatMap((source): readonly [string, SourceViewOptions][] => {
      if (!source.demoKey) return []

      const chunkCount = chunkCountByDemoSourceId.get(source.demoKey)
      if (chunkCount === undefined) return []

      return [[source.id, { chunkCount }]]
    }),
  )
}

function isLegacyCanonicalDemoSource(
  source: Source,
  canonicalDocumentIdByDemoSourceId: ReadonlyMap<string, string>,
): boolean {
  if (!source.demoKey) return false
  if (
    source.knowhereJobId === null &&
    (source.knowhereDocumentId === null ||
      source.knowhereDocumentId.startsWith("demo-doc-"))
  ) {
    return true
  }

  const canonicalDocumentId = canonicalDocumentIdByDemoSourceId.get(
    source.demoKey,
  )
  if (canonicalDocumentId === undefined) return false
  return source.knowhereDocumentId === canonicalDocumentId
}

function isMaterializedDemoSource(
  source: Source,
  canonicalDocumentIdByDemoSourceId: ReadonlyMap<string, string>,
): boolean {
  if (!source.demoKey || !source.knowhereDocumentId) return false
  const canonicalDocumentId = canonicalDocumentIdByDemoSourceId.get(
    source.demoKey,
  )
  return (
    canonicalDocumentId === undefined ||
    source.knowhereDocumentId !== canonicalDocumentId
  )
}
