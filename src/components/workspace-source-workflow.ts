"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import useSWRMutation from "swr/mutation"

import { workspaceSourceState } from "@/components/workspace-source-state"
import { workspaceClient } from "@/domains/workspace/client"
import { workspaceClientCache } from "@/domains/workspace/client-cache"
import type { SourceView } from "@/domains/sources/types"

type WorkspaceSourceWorkflowInput = {
  readonly initialSelectedDocumentId?: string | null
  readonly initialSources?: readonly SourceView[]
}

type WorkspaceSourceWorkflow = {
  readonly archivingSourceIds: string[]
  readonly handleArchiveSource: (sourceId: string) => Promise<void>
  readonly handleRetrySource: (sourceId: string) => Promise<void>
  readonly handleSelectedSourceChange: (sourceId: string | null) => void
  readonly handleSourceUploaded: (source: SourceView) => void
  readonly handleToggleIncluded: (sourceId: string, included: boolean) => void
  readonly readySourceCount: number
  readonly retryingSourceIds: string[]
  readonly selectedSourceId: string | null
  readonly setSelectedSourceId: (sourceId: string | null) => void
  readonly sourceTitlesByDocumentId: Readonly<Record<string, string>>
  readonly sources: SourceView[]
}

const sourcesSWRKey = workspaceClient.keys.sources
const archiveSourceSWRKey = workspaceClient.keys.archiveSource
const retrySourceSWRKey = workspaceClient.keys.retrySource

export function useWorkspaceSourceWorkflow({
  initialSelectedDocumentId = null,
  initialSources = [],
}: WorkspaceSourceWorkflowInput): WorkspaceSourceWorkflow {
  const initialSourceRows = useMemo(() => [...initialSources], [initialSources])
  const initialSelectedSourceId = workspaceSourceState.getInitialSelectedSourceId(
    initialSourceRows,
    initialSelectedDocumentId,
  )
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    initialSelectedSourceId,
  )
  const [sourceExclusionById, setSourceExclusionById] = useState<
    Record<string, boolean>
  >({})
  const [archivingSourceIds, setArchivingSourceIds] = useState<string[]>([])
  const [retryingSourceIds, setRetryingSourceIds] = useState<string[]>([])
  const shouldRefreshSourcesOnMount =
    workspaceClientCache.hasPendingSources(initialSourceRows)
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
  const resolvedSelectedSourceId =
    workspaceSourceState.getResolvedSelectedSourceId(
      sourceRows,
      selectedSourceId,
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
  const readySourceCount = sources.filter(isQueryableReadySource).length
  const { trigger: archiveSource } = useSWRMutation(
    archiveSourceSWRKey,
    archiveSourceMutation,
  )
  const { trigger: retrySource } = useSWRMutation(
    retrySourceSWRKey,
    retrySourceMutation,
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
          sources: sourceRows,
          sourceExclusionById,
        }).selectedSourceId,
      )
      setSourceExclusionById((current) =>
        workspaceSourceState.archiveSource({
          sourceId,
          selectedSourceId,
          sources: sourceRows,
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

  async function handleRetrySource(sourceId: string): Promise<void> {
    setRetryingSourceIds((current) =>
      workspaceSourceState.addPendingId(current, sourceId),
    )
    try {
      const source = await retrySource(sourceId)
      void mutateSources(
        (current) =>
          workspaceSourceState.upsertSource(current ?? sourceRows, source),
        { revalidate: false },
      )
      void mutateSources()
    } catch {
      void mutateSources()
    } finally {
      setRetryingSourceIds((current) =>
        workspaceSourceState.removePendingId(current, sourceId),
      )
    }
  }

  return {
    archivingSourceIds,
    handleArchiveSource,
    handleRetrySource,
    handleSelectedSourceChange,
    handleSourceUploaded,
    handleToggleIncluded,
    readySourceCount,
    retryingSourceIds,
    selectedSourceId: resolvedSelectedSourceId,
    setSelectedSourceId,
    sourceTitlesByDocumentId,
    sources,
  }
}

function isQueryableReadySource(source: SourceView): boolean {
  if (source.status !== "ready") return false
  return source.kind !== "remote"
}

function archiveSourceMutation(
  _key: string,
  { arg: sourceId }: { readonly arg: string },
): ReturnType<typeof workspaceClient.archiveSource> {
  return workspaceClient.archiveSource(sourceId)
}

function retrySourceMutation(
  _key: string,
  { arg: sourceId }: { readonly arg: string },
): ReturnType<typeof workspaceClient.retrySource> {
  return workspaceClient.retrySource(sourceId)
}
