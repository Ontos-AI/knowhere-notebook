import { NextResponse } from "next/server"

import { listMemoryAreas } from "@/integrations/memento/client"
import { withApiErrorResponse } from "@/lib/api-error-response"
import { notebookRequestContext } from "@/domains/workspace/request-context"

export async function GET(): Promise<NextResponse> {
  return withApiErrorResponse("memory-areas:list", async () => {
    const { workspace } = await notebookRequestContext.getAuthenticatedWithClient()
    const areas = await listMemoryAreas(workspace.id)
    return NextResponse.json({ areas })
  })
}
