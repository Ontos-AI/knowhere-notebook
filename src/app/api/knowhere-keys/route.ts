import type { NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { listMaskedKnowhereKeys } from "@/integrations/knowhere-keys"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function GET(): Promise<NextResponse> {
  return withApiErrorResponse("knowhere-keys:list", async () => {
    const user = await getCurrentUser()
    if (!user) {
      return nextRouteResponse.toNextResponse(
        routeResult.badRequest("Not authenticated."),
      )
    }
    const keys = await listMaskedKnowhereKeys()
    return nextRouteResponse.toNextResponse(routeResult.ok({ keys }))
  })
}
