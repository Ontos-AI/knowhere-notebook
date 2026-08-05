import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { activeWorkspaceCookieName } from "@/domains/workspace/service"
import { workspaceRepository } from "@/domains/workspace/repository"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:activate",
    async () => {
      const body = await routeResult.readJsonOrNull(request)
      const workspaceId =
        typeof body === "object" && body !== null && "workspaceId" in body
          ? String((body as { workspaceId?: unknown }).workspaceId)
          : ""
      const user = await getCurrentUser()
      if (!user) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("Not authenticated."),
        )
      }
      if (!workspaceId) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("workspaceId is required."),
        )
      }

      const workspace = await databaseRuntime.runPromise(
        workspaceRepository.findByIdAndUserIdEffect(workspaceId, user.id),
      )
      if (!workspace) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(404, "Workspace not found."),
        )
      }

      const response = nextRouteResponse.toNextResponse(routeResult.ok({}))
      response.cookies.set(activeWorkspaceCookieName, workspace.id, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      })
      return response
    },
    "Could not activate this workspace.",
  )
}
