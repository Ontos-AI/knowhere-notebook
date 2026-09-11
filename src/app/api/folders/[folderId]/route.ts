import type { NextRequest, NextResponse } from "next/server"

import { folderRouteRequest } from "@/domains/folders/route-request"
import { folderRouteService } from "@/domains/folders/route-service"
import { withApiErrorResponse } from "@/lib/api-error-response"
import { nextRouteResponse } from "@/lib/next-route-response"

type RouteContext = {
  params: Promise<{
    folderId: string
  }>
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  return withApiErrorResponse("folders:update", async () => {
    const { folderId } = await context.params
    const updateRequest = await folderRouteRequest.readUpdateFolder({ request })
    if (!updateRequest.ok) {
      return nextRouteResponse.toNextResponse(updateRequest.result)
    }

    return nextRouteResponse.toNextResponse(
      await folderRouteService.updateFolder({
        folderId,
        name: updateRequest.name,
        parentId: updateRequest.parentId,
      }),
    )
  })
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  return withApiErrorResponse("folders:delete", async () => {
    const { folderId } = await context.params
    return nextRouteResponse.toNextResponse(
      await folderRouteService.deleteFolder({ folderId }),
    )
  })
}
