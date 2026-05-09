import { headers } from "next/headers"
import { Effect } from "effect"

import { ensureApiKeyForWorkspace } from "@/lib/api-key-service"
import { authURLs } from "@/lib/auth-urls"
import { getCurrentUser } from "@/lib/auth"
import { DEMO_CHUNKS, DEMO_SOURCE } from "@/lib/demo-data"
import { makeKnowhereClient } from "@/lib/knowhere"
import { sourceViewOptionsBySourceId } from "@/lib/source-counts"
import { toSourceView } from "@/lib/source-view"
import { ensureWorkspace, listSourcesForWorkspace } from "@/lib/workspace"
import { uploadSourceAction } from "./actions"
import { WorkspaceShell } from "@/components/workspace-shell"

export const dynamic = "force-dynamic"

/**
 * Main workspace page. Server component.
 *
 * Two modes:
 *   - Guest (no Dashboard session): shows a static demo document with
 *     parsed chunks so first-time visitors can explore the product before
 *     logging in. Upload and chat are gated behind Dashboard login.
 *   - Authenticated: the existing workspace flow — verify session,
 *     ensure workspace + API key, load real sources.
 */
export default async function Home() {
  const user = await getCurrentUser()

  if (!user) {
    const dashboardOrigin =
      process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000"
    const dashboardLoginURL = `${dashboardOrigin}/login`
    const notebookPublicURL =
      process.env.NOTEBOOK_PUBLIC_URL ??
      authURLs.resolveNotebookPublicURLFromHeaders(await headers())
    const loginUrl = authURLs.buildDashboardLoginURL(
      dashboardLoginURL,
      notebookPublicURL,
    )
    return (
      <WorkspaceShell
        isGuest
        demoSource={DEMO_SOURCE}
        demoChunks={DEMO_CHUNKS}
        loginUrl={loginUrl}
      />
    )
  }

  const workspace = await ensureWorkspace(user.id)
  const cookieHeader = (await headers()).get("cookie") ?? ""
  const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
  const client = makeKnowhereClient(apiKey)
  const sources = await listSourcesForWorkspace(workspace.id)
  const sourceOptions = await Effect.runPromise(
    sourceViewOptionsBySourceId(sources, client),
  )

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
      sources={sources.map((source) =>
        toSourceView(source, sourceOptions.get(source.id)),
      )}
      uploadAction={uploadSourceAction}
    />
  )
}
