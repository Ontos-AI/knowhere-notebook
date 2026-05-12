"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import useSWRMutation from "swr/mutation"

import { workspaceSourceState } from "@/components/workspace-source-state"
import { workspaceClient } from "@/domains/workspace/client"
import { workspaceClientCache } from "@/domains/workspace/client-cache"
import type { SourceView } from "@/domains/sources/types"

type WorkspaceSourceWorkflowInput = {
  readonly initialSources?: readonly SourceView[]
  readonly isGuest?: boolean
}

type WorkspaceSourceWorkflow = {
  readonly archivingSourceIds: string[]
  readonly handleArchiveSource: (sourceId: string) => Promise<void>
  readonly handleSelectedSourceChange: (sourceId: string | null) => void
  readonly handleSourceUploaded: (source: SourceView) => void
  readonly handleToggleIncluded: (sourceId: string, included: boolean) => void
  readonly readySourceCount: number
  readonly selectedSourceId: string | null
  readonly setSelectedSourceId: (sourceId: string | null) => void
  readonly sourceTitlesByDocumentId: Readonly<Record<string, string>>
  readonly sources: SourceView[]
}

const sourcesSWRKey = workspaceClient.keys.sources
const archiveSourceSWRKey = workspaceClient.keys.archiveSource

export function useWorkspaceSourceWorkflow({
  initialSources = [],
  isGuest = false,
}: WorkspaceSourceWorkflowInput): WorkspaceSourceWorkflow {
  const initialSourceRows = useMemo(() => [...initialSources], [initialSources])
  const initialSelectedSourceId = workspaceSourceState.getInitialSelectedSourceId(
    initialSourceRows,
    isGuest,
  )
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    initialSelectedSourceId,
  )
  const [sourceExclusionById, setSourceExclusionById] = useState<
    Record<string, boolean>
  >({})
  const [archivingSourceIds, setArchivingSourceIds] = useState<string[]>([])
  const shouldRefreshSourcesOnMount =
    !isGuest && workspaceClientCache.hasPendingSources(initialSourceRows)
  const { data: serverSources, mutate: mutateSources } = useSWR(
    sourcesSWRKey,
    workspaceClient.fetchSources,
    {
      fallbackData: initialSourceRows,
      revalidateIfStale: false,
      revalidateOnMount: shouldRefreshSourcesOnMount,
      refreshInterval: (currentSources) =>
        workspaceClientCache.hasPendingSources(currentSources ?? []) ? 3000 : 0,
    },
  )
  const sourceRows = serverSources ?? initialSourceRows
  const sources = workspaceSourceState.applyQueryExclusions(
    sourceRows,
    sourceExclusionById,
  )
  const sourceTitlesByDocumentId = useMemo<Readonly<Record<string, string>>>(
    () =>
      Object.fromEntries(
        sources.flatMap((source): readonly [string, string][] =>
          source.documentId ? [[source.documentId, source.title]] : [],
        ),
      ),
    [sources],
  )
  const readySourceCount = sources.filter(
    (source) => source.status === "ready",
  ).length
  const { trigger: archiveSource } = useSWRMutation(
    archiveSourceSWRKey,
    archiveSourceMutation,
  )

  function handleSourceUploaded(source: SourceView): void {
    void mutateSources(
      (current) =>
        workspaceSourceState.upsertSource(current ?? sourceRows, source),
      { revalidate: false },
    )
    void mutateSources()
  }

  function handleToggleIncluded(sourceId: string, included: boolean): void {
    setSourceExclusionById((current) => ({
      ...current,
      [sourceId]: !included,
    }))
  }

  function handleSelectedSourceChange(sourceId: string | null): void {
    setSelectedSourceId(sourceId)
  }

  async function handleArchiveSource(sourceId: string): Promise<void> {
    setArchivingSourceIds((current) =>
      workspaceSourceState.addPendingId(current, sourceId),
    )
    try {
      await archiveSource(sourceId)
      void mutateSources(
        (current) =>
          (current ?? sourceRows).filter((source) => source.id !== sourceId),
        { revalidate: false },
      )
      setSelectedSourceId((current) =>
        workspaceSourceState.archiveSource({
          sourceId,
          selectedSourceId: current,
          sourceExclusionById,
        }).selectedSourceId,
      )
      setSourceExclusionById((current) =>
        workspaceSourceState.archiveSource({
          sourceId,
          selectedSourceId,
          sourceExclusionById: current,
        }).sourceExclusionById,
      )
    } catch {
      // The visible Source remains in place when archive fails.
    } finally {
      setArchivingSourceIds((current) =>
        workspaceSourceState.removePendingId(current, sourceId),
      )
    }
  }

  return {
    archivingSourceIds,
    handleArchiveSource,
    handleSelectedSourceChange,
    handleSourceUploaded,
    handleToggleIncluded,
    readySourceCount,
    selectedSourceId,
    setSelectedSourceId,
    sourceTitlesByDocumentId,
    sources,
  }
}

function archiveSourceMutation(
  _key: string,
  { arg: sourceId }: { readonly arg: string },
): ReturnType<typeof workspaceClient.archiveSource> {
  return workspaceClient.archiveSource(sourceId)
}
