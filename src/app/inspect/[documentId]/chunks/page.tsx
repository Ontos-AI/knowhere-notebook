import { Suspense } from "react"
import { connection } from "next/server"

import { WorkspaceShell } from "@/components/workspace-shell"
import { loadWorkspaceShellInitialState } from "@/domains/workspace/initial-state"
import { effectOperation } from "@/lib/effect-operation"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"

type InspectChunksPageProps = {
  readonly params: Promise<{
    readonly documentId: string
  }>
}

export default function InspectChunksPage(props: InspectChunksPageProps) {
  return (
    <Suspense>
      <InspectChunksPageContent params={props.params} />
    </Suspense>
  )
}

async function InspectChunksPageContent({
  params,
}: InspectChunksPageProps) {
  const { documentId } = await params
  await connection()
  const initialState = await loadWorkspaceInitialState()
  return <WorkspaceShell {...initialState} chunkViewDocumentId={documentId} />
}

async function loadWorkspaceInitialState(): ReturnType<
  typeof loadWorkspaceShellInitialState
> {
  try {
    return await loadWorkspaceShellInitialState()
  } catch (error) {
    logger.error("workspace: initial state failed", {
      error: summarizeUnknownError(error),
    })
    throw effectOperation.createBoundaryError(
      "Workspace initial state failed",
      error,
    )
  }
}
