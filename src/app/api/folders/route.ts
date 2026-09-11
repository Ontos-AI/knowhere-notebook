import type { NextRequest, NextResponse } from "next/server"

import { folderRouteRequest } from "@/domains/folders/route-request"
import { folderRouteService } from "@/domains/folders/route-service"
import { withApiErrorResponse } from "@/lib/api-error-response"
import { nextRouteResponse } from "@/lib/next-route-response"

export async function GET(): Promise<NextResponse> {
  return withApiErrorResponse("folders:list", async () =>
    nextRouteResponse.toNextResponse(await folderRouteService.listFolders()),
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withApiErrorResponse("folders:create", async () => {
    const createRequest = await folderRouteRequest.readCreateFolder({ request })
    if (!createRequest.ok) {
      return nextRouteResponse.toNextResponse(createRequest.result)
    }

    return nextRouteResponse.toNextResponse(
      await folderRouteService.createFolder({
        name: createRequest.name,
        parentId: createRequest.parentId,
      }),
    )
  })
}
