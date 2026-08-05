import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { workspaceRepository } from "@/domains/workspace/repository"
import { workspaceMembersRepository } from "@/infrastructure/auth/workspace-members-repository"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ workspaceId: string; userId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:members:remove",
    async () => {
      const { workspaceId, userId } = await params
      const user = await getCurrentUser()
      if (!user) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("Not authenticated."),
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
      if (workspace.userId !== user.id) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(403, "Only the workspace owner can remove members."),
        )
      }
      if (workspace.userId === userId) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(400, "The owner cannot be removed."),
        )
      }

      await databaseRuntime.runPromise(
        workspaceMembersRepository.removeMemberEffect(workspaceId, userId),
      )
      return nextRouteResponse.toNextResponse(routeResult.ok({}))
    },
    "Could not remove the workspace member.",
  )
}
