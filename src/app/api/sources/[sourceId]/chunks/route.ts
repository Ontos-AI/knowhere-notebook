import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { loadChunksForSource } from "@/lib/chunks";
import { getKnowhereClient } from "@/lib/knowhere";
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

  const chunks = await loadChunksForSource(source, getKnowhereClient());
  return NextResponse.json({ chunks });
}
