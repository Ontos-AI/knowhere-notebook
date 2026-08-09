import { revalidatePath } from "next/cache"
import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { sourceRouteUploadRequest } from "@/domains/sources/route-upload-request"
import { createSourceRouteService } from "@/domains/sources/route-service"
import { nextRouteContext } from "@/lib/next-route-context"
import { nextRouteResponse } from "@/lib/next-route-response"

const sourceRouteService = createSourceRouteService()

export async function GET(): Promise<NextResponse> {
  return withApiErrorResponse("sources:list", async () => {
    const routeContext = await nextRouteContext.read()
    const result = await sourceRouteService.listSources({
      cookieHeader: routeContext.cookieHeader,
    })

    return nextRouteResponse.toNextResponse(result)
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withApiErrorResponse(
    "sources:upload",
    async () => {
      const routeContext = await nextRouteContext.read()
      const upload = await sourceRouteUploadRequest.read(request)
      const result = await sourceRouteService.uploadSource({
        cookieHeader: routeContext.cookieHeader,
        upload,
        workspaceId: upload.workspaceId,
        onUploadFinished: () => {
          revalidatePath("/")
        },
      })

      return nextRouteResponse.toNextResponse(result)
    },
    "Upload failed. Try again or choose another file.",
  )
}
