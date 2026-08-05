import type { NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { getKnowhereKeyByLabel } from "@/integrations/knowhere-keys"
import { listKnowhereNamespaces } from "@/integrations/knowhere"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ label: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "knowhere-keys:namespaces",
    async () => {
      const { label } = await params
      const decodedLabel = decodeURIComponent(label)
      const user = await getCurrentUser()
      if (!user) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("Not authenticated."),
        )
      }
      const key = await getKnowhereKeyByLabel(decodedLabel)
      if (!key) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(404, `Key label '${decodedLabel}' not found.`),
        )
      }
      const namespaces = await listKnowhereNamespaces(key.apiKey)
      return nextRouteResponse.toNextResponse(routeResult.ok({ namespaces }))
    },
    "Could not list namespaces for this key.",
  )
}
