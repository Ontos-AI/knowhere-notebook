import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";

import { createSourceRouteService } from "@/domains/sources/route-service"

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

const ArchiveRequest = Schema.Struct({
  archived: Schema.Literal(true),
})

const sourceRouteService = createSourceRouteService()

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { sourceId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid request body." },
      { status: 400 },
    );
  }

  if (Schema.decodeUnknownEither(ArchiveRequest)(body)._tag === "Left") {
    return NextResponse.json(
      { message: "Request body must include `archived: true`." },
      { status: 400 },
    );
  }

  const result = await sourceRouteService.archiveSource({
    cookieHeader: await readCookieHeader(),
    sourceId,
  })

  return NextResponse.json(result.body, { status: result.status });
}

async function readCookieHeader(): Promise<string> {
  return (await headers()).get("cookie") ?? ""
}
