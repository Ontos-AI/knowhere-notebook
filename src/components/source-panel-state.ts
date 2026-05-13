import type { SourceView } from "@/domains/sources/types"

type ArchiveConfirmationStateInput = {
  readonly archivingSourceIds: readonly string[]
  readonly confirmSourceId: string | null
  readonly sources: readonly SourceView[]
}

type ArchiveConfirmationState = {
  readonly archivingSourceIdSet: ReadonlySet<string>
  readonly confirmSource: SourceView | null
  readonly isConfirmSourceArchiving: boolean
}

type NextSelectedSourceInput = {
  readonly sourceId: string
}

type SourcePanelState = {
  readonly getArchiveConfirmationState: (
    input: ArchiveConfirmationStateInput,
  ) => ArchiveConfirmationState
  readonly getNextSelectedSourceId: (
    input: NextSelectedSourceInput,
  ) => string | null
  readonly shouldCloseArchiveConfirmation: (
    confirmSourceId: string,
    archivingSourceIdSet: ReadonlySet<string>,
  ) => boolean
}

function getArchiveConfirmationState({
  archivingSourceIds,
  confirmSourceId,
  sources,
}: ArchiveConfirmationStateInput): ArchiveConfirmationState {
  const archivingSourceIdSet: ReadonlySet<string> = new Set(archivingSourceIds)
  const confirmSource =
    sources.find((source) => source.id === confirmSourceId) ?? null
  const isConfirmSourceArchiving =
    confirmSourceId !== null && archivingSourceIdSet.has(confirmSourceId)

  return {
    archivingSourceIdSet,
    confirmSource,
    isConfirmSourceArchiving,
  }
}

function getNextSelectedSourceId({ sourceId }: NextSelectedSourceInput): string | null {
  return sourceId
}

function shouldCloseArchiveConfirmation(
  confirmSourceId: string,
  archivingSourceIdSet: ReadonlySet<string>,
): boolean {
  return !archivingSourceIdSet.has(confirmSourceId)
}

export const sourcePanelState: SourcePanelState = {
  getArchiveConfirmationState,
  getNextSelectedSourceId,
  shouldCloseArchiveConfirmation,
}
