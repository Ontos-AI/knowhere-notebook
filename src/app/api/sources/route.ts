import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { sourceViewOptionsBySourceId } from "@/lib/source-counts";
import { reconcileSourcesForWorkspace } from "@/lib/source-reconcile";
import { toSourceView } from "@/lib/source-view";
import { ensureWorkspace } from "@/lib/workspace";

export async function GET(): Promise<NextResponse> {
  const user = await requireUser();
  const workspace = await ensureWorkspace(user.id);
  const sources = await reconcileSourcesForWorkspace(workspace);
  const sourceOptions = await sourceViewOptionsBySourceId(sources);

  return NextResponse.json({
    sources: sources.map((source) =>
      toSourceView(source, sourceOptions.get(source.id)),
    ),
  });
}
