import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { workspaceRepository } from "@/domains/workspace/repository"
import { knowhereApiKeysRepository } from "@/infrastructure/auth/knowhere-api-keys-repository"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:api-keys:list",
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

      const keys = await databaseRuntime.runPromise(
        knowhereApiKeysRepository.listByWorkspaceEffect(workspaceId),
      )
      return nextRouteResponse.toNextResponse(
        routeResult.ok({
          keys: keys.map((key) => ({
            id: key.id,
            label: key.label,
            createdAt: key.createdAt.toISOString(),
            isActive: workspace.activeKnowhereApiKeyId === key.id,
          })),
        }),
      )
    },
    "Could not list API keys.",
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "workspaces:api-keys:create",
    async () => {
      const { workspaceId } = await params
      const body = await routeResult.readJsonOrNull(request)
      const label =
        typeof body === "object" && body !== null && "label" in body
          ? String((body as { label?: unknown }).label).trim()
          : ""
      const apiKey =
        typeof body === "object" && body !== null && "apiKey" in body
          ? String((body as { apiKey?: unknown }).apiKey).trim()
          : ""
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
      if (!label || !apiKey) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("label and apiKey are required."),
        )
      }

      const existing = await databaseRuntime.runPromise(
        knowhereApiKeysRepository.findByWorkspaceAndLabelEffect(
          workspaceId,
          label,
        ),
      )
      if (existing) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(409, `A key labeled '${label}' already exists.`),
        )
      }

      const created = await databaseRuntime.runPromise(
        knowhereApiKeysRepository.createEffect({
          workspaceId,
          label,
          apiKey,
        }),
      )
      await databaseRuntime.runPromise(
        knowhereApiKeysRepository.setActiveEffect(workspaceId, created.id),
      )

      return nextRouteResponse.toNextResponse(
        routeResult.ok({
          key: {
            id: created.id,
            label: created.label,
            createdAt: created.createdAt.toISOString(),
            isActive: true,
          },
        }),
      )
    },
    "Could not create the API key.",
  )
}
