import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { Effect } from "effect"

import { ensureApiKeyForWorkspace } from "@/lib/api-key-service"
import { requireUser } from "@/lib/auth"
import { makeKnowhereClient } from "@/lib/knowhere"
import { sourceViewOptionsBySourceId } from "@/lib/source-counts"
import { reconcileSourcesForWorkspace } from "@/lib/source-reconcile"
import { toSourceView } from "@/lib/source-view"
import { ensureWorkspace } from "@/lib/workspace"

export async function GET(): Promise<NextResponse> {
  const user = await requireUser();
  const workspace = await ensureWorkspace(user.id);
  const cookieHeader = (await headers()).get("cookie") ?? ""
  const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
  const client = makeKnowhereClient(apiKey)
  const sources = await reconcileSourcesForWorkspace(workspace, client);
  const sourceOptions = await Effect.runPromise(
    sourceViewOptionsBySourceId(sources, client),
  )

  return NextResponse.json({
    sources: sources.map((source) =>
      toSourceView(source, sourceOptions.get(source.id)),
    ),
  });
}
