import type { SourceView } from "@/domains/sources/types"

type SourceExclusionState = Readonly<Record<string, boolean>>

type ArchiveSourceInput = {
  readonly sourceId: string
  readonly selectedSourceId: string | null
  readonly sourceExclusionById: SourceExclusionState
}

type ArchiveSourceResult = {
  readonly selectedSourceId: string | null
  readonly sourceExclusionById: Record<string, boolean>
}

type WorkspaceSourceStateModule = {
  readonly getInitialSelectedSourceId: (
    sources: readonly SourceView[],
    isGuest: boolean,
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
  isGuest: boolean,
): string | null {
  if (!isGuest) return null

  return sources.find((source) => source.status === "ready")?.id ?? null
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
  return {
    selectedSourceId:
      input.selectedSourceId === input.sourceId ? null : input.selectedSourceId,
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
  getInitialSelectedSourceId,
  applyQueryExclusions,
  upsertSource,
  archiveSource,
  addPendingId,
  removePendingId,
  removeRecordKey,
}
