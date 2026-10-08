import { NextResponse } from "next/server"

import { notebookRequestContext } from "@/domains/workspace/request-context"
import { deleteMemoryItem } from "@/integrations/memento/client"
import { withApiErrorResponse } from "@/lib/api-error-response"

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ itemId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse("memory-items:delete", async () => {
    const { itemId } = await context.params
    const { workspace } = await notebookRequestContext.getAuthenticatedWithClient()
    await deleteMemoryItem(workspace.id, itemId)
    return NextResponse.json({ deleted: true })
  })
}
