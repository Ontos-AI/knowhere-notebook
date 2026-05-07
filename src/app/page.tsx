import { requireUser } from "@/lib/auth";
import { ensureWorkspace } from "@/lib/workspace";
import { WorkspaceShell } from "@/components/workspace-shell";

/**
 * Main workspace page. Server component.
 *
 * On every request: verify the session with Dashboard, ensure the user's
 * workspace row exists, and pass identity + workspace metadata down to
 * the client shell. Anonymous requests are redirected to Dashboard login
 * inside `requireUser`.
 */
export default async function Home() {
  const user = await requireUser();
  const workspace = await ensureWorkspace(user.id);

  return (
    <WorkspaceShell
      user={{
        id: user.id,
        name: user.name ?? null,
        email: user.email ?? null,
      }}
      workspace={{
        id: workspace.id,
        namespace: workspace.namespace,
      }}
    />
  );
}
