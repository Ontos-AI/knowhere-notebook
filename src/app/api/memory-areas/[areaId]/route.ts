import { NextResponse } from "next/server"

import { notebookRequestContext } from "@/domains/workspace/request-context"
import { getMemoryAreaDocument } from "@/integrations/memento/client"
import { withApiErrorResponse } from "@/lib/api-error-response"

export async function GET(
  _request: Request,
  context: { params: Promise<{ areaId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse("memory-areas:read", async () => {
    const { areaId } = await context.params
    const { workspace } = await notebookRequestContext.getAuthenticatedWithClient()
    const document = await getMemoryAreaDocument(workspace.id, areaId)
    return NextResponse.json(document)
  })
}
