import { headers } from "next/headers"

import { ensureApiKeyForWorkspace } from "@/lib/api-key-service";
import { requireUser } from "@/lib/auth";
import { getKnowhereClient } from "@/lib/knowhere";
import { sourceViewOptionsBySourceId } from "@/lib/source-counts";
import { toSourceView } from "@/lib/source-view";
import { ensureWorkspace, listSourcesForWorkspace } from "@/lib/workspace";
import { uploadSourceAction } from "./actions";
import { WorkspaceShell } from "@/components/workspace-shell";

export const dynamic = "force-dynamic"

/**
 * Main workspace page. Server component.
 *
 * On every request: verify the session with Dashboard, ensure the user's
 * workspace row exists, auto-create a Knowhere API key if none exists,
 * and pass identity + workspace metadata down to the client shell.
 * Anonymous requests are redirected to Dashboard login inside `requireUser`.
 */
export default async function Home() {
  const user = await requireUser();
  const workspace = await ensureWorkspace(user.id);
  const cookieHeader = (await headers()).get("cookie") ?? ""
  const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
  const client = getKnowhereClient(apiKey)
  const sources = await listSourcesForWorkspace(workspace.id);
  const sourceOptions = await sourceViewOptionsBySourceId(sources, client);

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
  );
}
