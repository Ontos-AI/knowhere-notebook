import { NextResponse, type NextRequest } from "next/server"
import { Effect } from "effect"

import {
  getChunkPageParams,
  loadChunkPageForSource,
  loadChunksForSource,
  type ChunkPage,
  type ChunkPageParams,
} from "@/lib/chunks"
import type { ParsedChunkView } from "@/lib/types"
import { demoData } from "@/lib/demo-data"
import { notebookRequestContext } from "@/lib/notebook-request-context"
import {
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
  const notebookContext =
    await notebookRequestContext.getOptionalAuthenticated();

  if (!notebookContext) {
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

  const { workspace } = notebookContext
  const source = await findSourceInWorkspace(workspace.id, sourceId);

  if (!source) {
    return NextResponse.json({ message: "Source not found." }, { status: 404 });
  }

  const demoChunks = await demoData.loadChunksForDocumentId(
    source.knowhereDocumentId,
  )
  if (demoChunks) {
    return NextResponse.json(
      shouldLoadAll ? { chunks: demoChunks } : toChunkPage(demoChunks, pageParams),
    )
  }

  const { client } = await notebookRequestContext.getClientForWorkspace(
    workspace,
  )
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
