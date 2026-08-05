import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { knowhereApiKeysRepository } from "@/infrastructure/auth/knowhere-api-keys-repository"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ apiKeyId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "api-keys:set-active",
    async () => {
      const { apiKeyId } = await params
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

      const key = await databaseRuntime.runPromise(
        knowhereApiKeysRepository.findByIdAndUserEffect(apiKeyId, user.id),
      )
      if (!key) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(404, "API key not found."),
        )
      }

      await databaseRuntime.runPromise(
        knowhereApiKeysRepository.setActiveEffect(workspaceId, key.id),
      )
      return nextRouteResponse.toNextResponse(routeResult.ok({}))
    },
    "Could not update the API key.",
  )
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ apiKeyId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "api-keys:delete",
    async () => {
      const { apiKeyId } = await params
      const user = await getCurrentUser()
      if (!user) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("Not authenticated."),
        )
      }

      const key = await databaseRuntime.runPromise(
        knowhereApiKeysRepository.findByIdAndUserEffect(apiKeyId, user.id),
      )
      if (!key) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(404, "API key not found."),
        )
      }

      await databaseRuntime.runPromise(
        knowhereApiKeysRepository.softDeleteEffect(apiKeyId, user.id),
      )
      // Sweep: any workspace pointing at this key loses its active credential.
      await databaseRuntime.runPromise(
        knowhereApiKeysRepository.clearActiveForKeyEffect(apiKeyId, user.id),
      )

      return nextRouteResponse.toNextResponse(routeResult.ok({}))
    },
    "Could not delete the API key.",
  )
}
