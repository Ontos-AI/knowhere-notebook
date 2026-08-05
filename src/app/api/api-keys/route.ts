import type { NextRequest, NextResponse } from "next/server"
import { Effect } from "effect"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { workspaceRepository } from "@/domains/workspace/repository"
import { knowhereApiKeysRepository } from "@/infrastructure/auth/knowhere-api-keys-repository"
import { validateKnowhereApiKey } from "@/integrations/knowhere"
import { activeWorkspaceCookieName } from "@/domains/workspace/service"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

/** The home namespace every key add creates a workspace for. */
const defaultNamespace = "default"

export async function GET(): Promise<NextResponse> {
  return withApiErrorResponse("api-keys:list", async () => {
    const user = await getCurrentUser()
    if (!user) {
      return nextRouteResponse.toNextResponse(
        routeResult.badRequest("Not authenticated."),
      )
    }

    const keys = await databaseRuntime.runPromise(
      knowhereApiKeysRepository.listByUserEffect(user.id),
    )
    return nextRouteResponse.toNextResponse(
      routeResult.ok({
        keys: keys.map((key) => ({
          id: key.id,
          label: key.label,
          mask: key.keyMask,
          createdAt: key.createdAt.toISOString(),
        })),
      }),
    )
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withApiErrorResponse(
    "api-keys:create",
    async () => {
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
      if (!label || !apiKey) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("label and apiKey are required."),
        )
      }

      const existing = await databaseRuntime.runPromise(
        knowhereApiKeysRepository.listByUserEffect(user.id),
      )
      if (existing.some((key) => key.label === label)) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(409, `A key labeled '${label}' already exists.`),
        )
      }

      const isValid = await validateKnowhereApiKey(apiKey)
      if (!isValid) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(422, "Invalid API key. Check it and try again."),
        )
      }

      const created = await databaseRuntime.runPromise(
        knowhereApiKeysRepository.createForUserEffect({
          userId: user.id,
          label,
          apiKey,
        }),
      )

      // Auto-create the (user, "default") home workspace with this key active.
      const workspace = await databaseRuntime.runPromise(
        workspaceRepository.findByUserIdAndNamespaceEffect(
          user.id,
          defaultNamespace,
        ),
      )
      const homeWorkspace =
        workspace ??
        (await databaseRuntime.runPromise(
          workspaceRepository
            .insertForUserNamespaceEffect(user.id, defaultNamespace)
            .pipe(
              Effect.flatMap(() =>
                workspaceRepository.findByUserIdAndNamespaceEffect(
                  user.id,
                  defaultNamespace,
                ),
              ),
            ),
        ))

      if (homeWorkspace) {
        await databaseRuntime.runPromise(
          knowhereApiKeysRepository.setActiveEffect(
            homeWorkspace.id,
            created.id,
          ),
        )
      }

      const response = nextRouteResponse.toNextResponse(
        routeResult.ok({
          key: {
            id: created.id,
            label: created.label,
            mask: created.keyMask,
            createdAt: created.createdAt.toISOString(),
          },
          workspace: homeWorkspace
            ? { id: homeWorkspace.id, namespace: homeWorkspace.namespace }
            : null,
        }),
      )
      if (homeWorkspace) {
        // Make the home workspace active immediately so the next SSR load
        // (router.refresh on the client) lands on it with a fresh thread.
        response.cookies.set(activeWorkspaceCookieName, homeWorkspace.id, {
          httpOnly: false,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        })
      }
      return response
    },
    "Could not add the API key.",
  )
}
