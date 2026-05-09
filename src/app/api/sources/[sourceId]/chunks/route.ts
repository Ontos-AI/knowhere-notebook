import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { Effect } from "effect"

import { ensureApiKeyForWorkspace } from "@/lib/api-key-service"
import { requireUser } from "@/lib/auth"
import { loadChunksForSource } from "@/lib/chunks"
import { makeKnowhereClient } from "@/lib/knowhere"
import { ensureWorkspace, findSourceInWorkspace } from "@/lib/workspace"

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

  const cookieHeader = (await headers()).get("cookie") ?? ""
  const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
  const client = makeKnowhereClient(apiKey)
  const chunks = await Effect.runPromise(
    loadChunksForSource(source, client),
  )
  return NextResponse.json({ chunks });
}
