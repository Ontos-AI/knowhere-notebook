import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { Effect } from "effect"

import { ensureApiKeyForWorkspace } from "@/lib/api-key-service"
import { getCurrentUser } from "@/lib/auth"
import {
  getChunkPageParams,
  loadChunkPageForSource,
  loadChunksForSource,
  type ChunkPage,
  type ChunkPageParams,
} from "@/lib/chunks"
import type { ParsedChunkView } from "@/lib/types"
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
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { sourceId } = await context.params;
  const shouldLoadAll =
    !request.nextUrl.searchParams.has("page") &&
    !request.nextUrl.searchParams.has("pageSize")
  const pageParams = getChunkPageParams(request.nextUrl.searchParams);
  const user = await getCurrentUser();

  if (!user) {
    const chunks = await demoData.loadChunksForSource(sourceId);
    if (!chunks) {
      return NextResponse.json(
        { message: "Source not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      shouldLoadAll ? { chunks } : toChunkPage(chunks, pageParams),
    );
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
  if (shouldLoadAll) {
    const chunks = await Effect.runPromise(
      loadChunksForSource(source, client, { assetUrlsByFilePath }),
    )
    return NextResponse.json({ chunks })
  }

  const chunkPage = await Effect.runPromise(
    loadChunkPageForSource(source, client, pageParams, { assetUrlsByFilePath }),
  )
  return NextResponse.json(chunkPage);
}

function toChunkPage(
  chunks: readonly ParsedChunkView[],
  params: ChunkPageParams,
): ChunkPage {
  const start = (params.page - 1) * params.pageSize
  const pageChunks = chunks.slice(start, start + params.pageSize)
  const totalPages =
    chunks.length === 0 ? 0 : Math.ceil(chunks.length / params.pageSize)

  return {
    chunks: pageChunks,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total: chunks.length,
      totalPages,
    },
  }
}
