import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { workspaceRepository } from "@/domains/workspace/repository"
import { knowhereApiKeysRepository } from "@/infrastructure/auth/knowhere-api-keys-repository"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ workspaceId: string; apiKeyId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:api-keys:set-active",
    async () => {
      const { workspaceId, apiKeyId } = await params
      const body = await routeResult.readJsonOrNull(request)
      const isActive =
        typeof body === "object" &&
        body !== null &&
        "isActive" in body &&
        (body as { isActive?: unknown }).isActive === true
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

      if (isActive) {
        const key = await databaseRuntime.runPromise(
          knowhereApiKeysRepository.findByIdAndWorkspaceEffect(
            apiKeyId,
            workspaceId,
          ),
        )
        if (!key) {
          return nextRouteResponse.toNextResponse(
            routeResult.error(404, "API key not found."),
          )
        }
        await databaseRuntime.runPromise(
          knowhereApiKeysRepository.setActiveEffect(workspaceId, key.id),
        )
      } else {
        await databaseRuntime.runPromise(
          knowhereApiKeysRepository.setActiveEffect(workspaceId, null),
        )
      }

      return nextRouteResponse.toNextResponse(routeResult.ok({}))
    },
    "Could not update the API key.",
  )
}

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ workspaceId: string; apiKeyId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:api-keys:delete",
    async () => {
      const { workspaceId, apiKeyId } = await params
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

      const key = await databaseRuntime.runPromise(
        knowhereApiKeysRepository.findByIdAndWorkspaceEffect(
          apiKeyId,
          workspaceId,
        ),
      )
      if (!key) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(404, "API key not found."),
        )
      }

      await databaseRuntime.runPromise(
        knowhereApiKeysRepository.softDeleteEffect(apiKeyId, workspaceId),
      )
      if (workspace.activeKnowhereApiKeyId === apiKeyId) {
        await databaseRuntime.runPromise(
          knowhereApiKeysRepository.setActiveEffect(workspaceId, null),
        )
      }

      return nextRouteResponse.toNextResponse(routeResult.ok({}))
    },
    "Could not delete the API key.",
  )
}
