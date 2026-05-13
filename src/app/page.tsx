import { Suspense } from "react"
import { WorkspaceShell } from "@/components/workspace-shell"
import { loadWorkspaceShellInitialState } from "@/domains/workspace/initial-state"
import { connection } from "next/server"

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  )
}

async function HomeContent() {
  await connection()
  return renderWorkspaceShell()
}

export async function renderWorkspaceShell() {
  return <WorkspaceShell {...(await loadWorkspaceShellInitialState())} />
}
