import type { NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { workspaceService } from "@/domains/workspace/service"
import { ensureApiKeyForWorkspace } from "@/integrations/knowhere-credentials"
import { listKnowhereNamespaces } from "@/integrations/knowhere"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function GET(): Promise<NextResponse> {
  return withApiErrorResponse("namespaces:list", async () => {
    const user = await getCurrentUser()
    if (!user) {
      return nextRouteResponse.toNextResponse(routeResult.badRequest("Not authenticated."))
    }
    const workspace = await workspaceService.ensureWorkspace(user.id)
    const apiKey = await ensureApiKeyForWorkspace(workspace.id)
    const namespaces = await listKnowhereNamespaces(apiKey)
    return nextRouteResponse.toNextResponse(
      routeResult.ok({ namespaces }),
    )
  })
}
