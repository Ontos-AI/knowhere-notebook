import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import {
  workspaceService,
  activeWorkspaceCookieName,
} from "@/domains/workspace/service"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { knowhereApiKeysRepository } from "@/infrastructure/auth/knowhere-api-keys-repository"
import { localizeWorkspaceNamespace } from "@/domains/sources/localize-namespace"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:create",
    async () => {
      const body = await routeResult.readJsonOrNull(request)
      const keyId =
        typeof body === "object" && body !== null && "keyId" in body
          ? String((body as { keyId?: unknown }).keyId)
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
      if (!keyId || !namespace) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("keyId and namespace are required."),
        )
      }

      const key = await databaseRuntime
        .runPromise(
          knowhereApiKeysRepository.findByIdAndUserEffect(keyId, user.id),
        )
        .catch(() => null)
      if (!key) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("API key not found."),
        )
      }

      const workspace = await workspaceService.ensureWorkspaceForNamespace(
        user.id,
        namespace,
      )
      await databaseRuntime
        .runPromise(
          knowhereApiKeysRepository.setActiveEffect(workspace.id, key.id),
        )
        .catch(() => {})

      const apiKey = await databaseRuntime
        .runPromise(knowhereApiKeysRepository.decryptStoredEffect(key))
        .catch(() => null)
      const sources = apiKey
        ? await localizeWorkspaceNamespace(workspace, apiKey)
        : []

      const response = nextRouteResponse.toNextResponse(
        routeResult.ok({
          workspace: {
            id: workspace.id,
            namespace: workspace.namespace,
          },
          sources,
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
