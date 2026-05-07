import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { Effect } from "effect";
import { KnowhereClient, knowhereClientLayer } from "@/lib/knowhere";
import { ensureWorkspace, findSourceInWorkspace, softDeleteSource } from "@/lib/workspace";

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

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

  if (
    typeof body !== "object" ||
    body === null ||
    (body as Record<string, unknown>).archived !== true
  ) {
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
    const client = await Effect.runPromise(
      KnowhereClient.pipe(Effect.provide(knowhereClientLayer)),
    );
    await client.documents.archive(source.knowhereDocumentId);
  }

  await softDeleteSource(workspace.id, sourceId);

  return NextResponse.json({ id: sourceId, archived: true });
}
