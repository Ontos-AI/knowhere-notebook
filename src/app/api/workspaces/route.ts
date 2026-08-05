import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import {
  workspaceService,
  activeWorkspaceCookieName,
} from "@/domains/workspace/service"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:create",
    async () => {
      const body = await routeResult.readJsonOrNull(request)
      const keyLabel =
        typeof body === "object" && body !== null && "keyLabel" in body
          ? String((body as { keyLabel?: unknown }).keyLabel)
          : ""
      const namespace =
        typeof body === "object" && body !== null && "namespace" in body
          ? String((body as { namespace?: unknown }).namespace)
          : ""
      const user = await getCurrentUser()
      if (!user) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("Not authenticated."),
        )
      }
      if (!keyLabel || !namespace) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("keyLabel and namespace are required."),
        )
      }

      const workspace =
        await workspaceService.ensureWorkspaceForLabelAndNamespace(
          user.id,
          keyLabel,
          namespace,
        )

      const response = nextRouteResponse.toNextResponse(
        routeResult.ok({
          workspace: {
            id: workspace.id,
            namespace: workspace.namespace,
            keyLabel: workspace.knowhereKeyLabel,
          },
        }),
      )
      response.cookies.set(activeWorkspaceCookieName, workspace.id, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      })
      return response
    },
    "Could not create this workspace.",
  )
}
