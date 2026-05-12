import { WorkspaceShell } from "@/components/workspace-shell"
import { loadWorkspaceShellInitialState } from "@/domains/workspace/initial-state"

export const dynamic = "force-dynamic"

export default async function Home() {
  return <WorkspaceShell {...(await loadWorkspaceShellInitialState())} />
}
