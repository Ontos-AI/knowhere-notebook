import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { loadChunksForSource } from "@/lib/chunks";
import { Effect } from "effect";
import { KnowhereClient, knowhereClientLayer } from "@/lib/knowhere";
import { ensureWorkspace, findSourceInWorkspace } from "@/lib/workspace";

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const user = await requireUser();
  const workspace = await ensureWorkspace(user.id);
  const { sourceId } = await context.params;
  const source = await findSourceInWorkspace(workspace.id, sourceId);

  if (!source) {
    return NextResponse.json({ message: "Source not found." }, { status: 404 });
  }

  const client = await Effect.runPromise(
    KnowhereClient.pipe(Effect.provide(knowhereClientLayer)),
  );
  const chunks = await loadChunksForSource(source, client);
  return NextResponse.json({ chunks });
}
