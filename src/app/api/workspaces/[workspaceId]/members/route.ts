import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { workspaceRepository } from "@/domains/workspace/repository"
import { workspaceMembersRepository } from "@/infrastructure/auth/workspace-members-repository"
import { usersRepository } from "@/infrastructure/auth/users-repository"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:members:list",
    async () => {
      const { workspaceId } = await params
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
      const members = await databaseRuntime.runPromise(
        workspaceMembersRepository.listMembersEffect(workspaceId),
      )
      const memberUsers = await Promise.all(
        members.map((member) =>
          databaseRuntime.runPromise(
            usersRepository.findByIdEffect(member.userId),
          ),
        ),
      )
      return nextRouteResponse.toNextResponse(
        routeResult.ok({
          members: members.map((member, index) => ({
            userId: member.userId,
            email: memberUsers[index]?.email ?? null,
            name: memberUsers[index]?.name ?? null,
          })),
        }),
      )
    },
    "Could not list workspace members.",
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:members:add",
    async () => {
      const { workspaceId } = await params
      const body = await routeResult.readJsonOrNull(request)
      const email =
        typeof body === "object" && body !== null && "email" in body
          ? String((body as { email?: unknown }).email).trim().toLowerCase()
          : ""
      const user = await getCurrentUser()
      if (!user) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("Not authenticated."),
        )
      }
      if (!email) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("email is required."),
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
          routeResult.error(403, "Only the workspace owner can invite members."),
        )
      }

      const memberUser = await databaseRuntime.runPromise(
        usersRepository.findByEmailEffect(email),
      )
      if (!memberUser) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(
            404,
            "No Notebook user with that email. Users are admin-provisioned.",
          ),
        )
      }

      await databaseRuntime.runPromise(
        workspaceMembersRepository.addMemberEffect(workspaceId, memberUser.id),
      )
      return nextRouteResponse.toNextResponse(
        routeResult.ok({ member: { userId: memberUser.id } }),
      )
    },
    "Could not add the workspace member.",
  )
}
