import type { NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { workspaceService } from "@/domains/workspace/service"
import { ensureApiKeyForWorkspace } from "@/integrations/dashboard/api-key-service"
import { listKnowhereNamespaces } from "@/integrations/knowhere"
import { nextRouteContext } from "@/lib/next-route-context"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function GET(): Promise<NextResponse> {
  return withApiErrorResponse("namespaces:list", async () => {
    const routeContext = await nextRouteContext.read()
    const user = await getCurrentUser()
    if (!user) {
      return nextRouteResponse.toNextResponse(routeResult.badRequest("Not authenticated."))
    }
    const workspace = await workspaceService.ensureWorkspace(user.id)
    const apiKey = await ensureApiKeyForWorkspace(
      workspace.id,
      routeContext.cookieHeader,
    )
    const namespaces = await listKnowhereNamespaces(apiKey)
    return nextRouteResponse.toNextResponse(
      routeResult.ok({ namespaces }),
    )
  })
}
