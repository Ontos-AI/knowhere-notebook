import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { Effect } from "effect"

import { ensureApiKeyForWorkspace } from "@/lib/api-key-service"
import { getCurrentUser } from "@/lib/auth"
import { loadChunksForSource } from "@/lib/chunks"
import { demoData } from "@/lib/demo-data"
import { makeKnowhereClient } from "@/lib/knowhere"
import {
  ensureWorkspace,
  findSourceInWorkspace,
  getSourceParseAssetUrls,
} from "@/lib/workspace"

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { sourceId } = await context.params;
  const user = await getCurrentUser();

  if (!user) {
    const chunks = await demoData.loadChunksForSource(sourceId);
    if (!chunks) {
      return NextResponse.json(
        { message: "Source not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ chunks });
  }

  const workspace = await ensureWorkspace(user.id);
  const source = await findSourceInWorkspace(workspace.id, sourceId);

  if (!source) {
    return NextResponse.json({ message: "Source not found." }, { status: 404 });
  }

  const cookieHeader = (await headers()).get("cookie") ?? ""
  const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
  const client = makeKnowhereClient(apiKey)
  const assetUrlsByFilePath = await getSourceParseAssetUrls(
    workspace.id,
    source.id,
  )
  const chunks = await Effect.runPromise(
    loadChunksForSource(source, client, { assetUrlsByFilePath }),
  )
  return NextResponse.json({ chunks });
}
