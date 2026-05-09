import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";

import { ensureApiKeyForWorkspace } from "@/lib/api-key-service";
import { requireUser } from "@/lib/auth";
import { makeKnowhereClient } from "@/lib/knowhere";
import { ensureWorkspace, findSourceInWorkspace, softDeleteSource } from "@/lib/workspace";

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

const ArchiveRequest = Schema.Struct({
  archived: Schema.Literal(true),
})

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const user = await requireUser();
  const workspace = await ensureWorkspace(user.id);
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

  const source = await findSourceInWorkspace(workspace.id, sourceId);
  if (!source) {
    return NextResponse.json(
      { message: "Source not found." },
      { status: 404 },
    );
  }

  if (source.knowhereDocumentId) {
    const cookieHeader = (await headers()).get("cookie") ?? ""
    const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
    const client = makeKnowhereClient(apiKey)
    await client.documents.archive(source.knowhereDocumentId);
  }

  await softDeleteSource(workspace.id, sourceId);

  return NextResponse.json({ id: sourceId, archived: true });
}
