import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"

import {
  getChunkPageParams,
} from "@/domains/chunks"
import { createSourceRouteService } from "@/domains/sources/route-service"

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

const sourceRouteService = createSourceRouteService()

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { sourceId } = await context.params;
  const shouldLoadAll =
    !request.nextUrl.searchParams.has("page") &&
    !request.nextUrl.searchParams.has("pageSize")
  const pageParams = getChunkPageParams(request.nextUrl.searchParams);
  const result = await sourceRouteService.loadSourceChunks({
    cookieHeader: await readCookieHeader(),
    pageParams,
    shouldLoadAll,
    sourceId,
  })

  return NextResponse.json(result.body, { status: result.status });
}

async function readCookieHeader(): Promise<string> {
  return (await headers()).get("cookie") ?? ""
}
