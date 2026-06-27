import type { SourceView } from "@/domains/sources/types"

type SourceExclusionState = Readonly<Record<string, boolean>>

type ArchiveSourceInput = {
  readonly sourceId: string
  readonly selectedSourceId: string | null
  readonly sources: readonly SourceView[]
  readonly sourceExclusionById: SourceExclusionState
}

type ArchiveSourceResult = {
  readonly selectedSourceId: string | null
  readonly sourceExclusionById: Record<string, boolean>
}

type WorkspaceSourceStateModule = {
  readonly getFirstReadySourceId: (
    sources: readonly SourceView[],
  ) => string | null
  readonly getInitialSelectedSourceId: (
    sources: readonly SourceView[],
    preferredDocumentId?: string | null,
  ) => string | null
  readonly getResolvedSelectedSourceId: (
    sources: readonly SourceView[],
    selectedSourceId: string | null,
  ) => string | null
  readonly applyQueryExclusions: (
    sources: readonly SourceView[],
    sourceExclusionById: SourceExclusionState,
  ) => SourceView[]
  readonly upsertSource: (
    sources: readonly SourceView[],
    source: SourceView,
  ) => SourceView[]
  readonly archiveSource: (input: ArchiveSourceInput) => ArchiveSourceResult
  readonly addPendingId: (currentIds: readonly string[], id: string) => string[]
  readonly removePendingId: (
    currentIds: readonly string[],
    id: string,
  ) => string[]
  readonly removeRecordKey: <T>(
    record: Readonly<Record<string, T>>,
    key: string,
  ) => Record<string, T>
}

function getInitialSelectedSourceId(
  sources: readonly SourceView[],
  preferredDocumentId: string | null = null,
): string | null {
  if (preferredDocumentId) {
    const preferredSource = sources.find(
      (source) =>
        source.documentId === preferredDocumentId && isReadySource(source),
    )
    if (preferredSource) return preferredSource.id
  }

  return getFirstReadySourceId(sources)
}

function getFirstReadySourceId(sources: readonly SourceView[]): string | null {
  return sources.find(isReadySource)?.id ?? null
}

function getResolvedSelectedSourceId(
  sources: readonly SourceView[],
  selectedSourceId: string | null,
): string | null {
  const selectedSource = sources.find((source) => source.id === selectedSourceId)
  if (selectedSource && isReadySource(selectedSource)) {
    return selectedSource.id
  }

  return getFirstReadySourceId(sources)
}

function isReadySource(source: SourceView): boolean {
  return source.status === "ready"
}

function applyQueryExclusions(
  sources: readonly SourceView[],
  sourceExclusionById: SourceExclusionState,
): SourceView[] {
  return sources.map((source) => ({
    ...source,
    excludedFromQuery:
      sourceExclusionById[source.id] ?? source.excludedFromQuery,
  }))
}

function upsertSource(
  sources: readonly SourceView[],
  source: SourceView,
): SourceView[] {
  return [source, ...sources.filter((candidate) => candidate.id !== source.id)]
}

function archiveSource(input: ArchiveSourceInput): ArchiveSourceResult {
  const remainingSources = input.sources.filter(
    (source) => source.id !== input.sourceId,
  )
  return {
    selectedSourceId:
      input.selectedSourceId === input.sourceId
        ? getFirstReadySourceId(remainingSources)
        : getResolvedSelectedSourceId(remainingSources, input.selectedSourceId),
    sourceExclusionById: removeRecordKey(
      input.sourceExclusionById,
      input.sourceId,
    ),
  }
}

function addPendingId(currentIds: readonly string[], id: string): string[] {
  return currentIds.includes(id) ? [...currentIds] : [...currentIds, id]
}

function removePendingId(currentIds: readonly string[], id: string): string[] {
  return currentIds.filter((currentId) => currentId !== id)
}

function removeRecordKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Record<string, T> {
  const remaining: Record<string, T> = {}
  Object.entries(record).forEach(([recordKey, value]) => {
    if (recordKey !== key) remaining[recordKey] = value
  })
  return remaining
}

export const workspaceSourceState: WorkspaceSourceStateModule = {
  getFirstReadySourceId,
  getInitialSelectedSourceId,
  getResolvedSelectedSourceId,
  applyQueryExclusions,
  upsertSource,
  archiveSource,
  addPendingId,
  removePendingId,
  removeRecordKey,
}
