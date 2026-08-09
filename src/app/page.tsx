import { Suspense } from "react"
import { redirect } from "next/navigation"
import { WorkspaceShell } from "@/components/workspace-shell"
import { loadWorkspaceShellInitialState } from "@/domains/workspace/initial-state"
import { effectOperation } from "@/lib/effect-operation"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"
import { connection } from "next/server"

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  )
}

export async function HomeContent() {
  await connection()
  const initialState = await loadWorkspaceInitialState()
  if (!initialState.user) {
    redirect("/login")
  }
  return <WorkspaceShell {...initialState} />
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
