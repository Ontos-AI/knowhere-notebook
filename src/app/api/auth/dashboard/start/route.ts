import type { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

import { getDashboardProvider } from "@/infrastructure/auth/oauth-providers"
import {
  DashboardLoginError,
  loginWithDashboardSession,
} from "@/infrastructure/auth/oauth"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function GET(_request: NextRequest): Promise<NextResponse> {
  // `cookies()` is a dynamic API and must be reached BEFORE any early
  // return: with cacheComponents, Next.js prerenders GET handlers at build
  // time, and an early `getDashboardProvider()` 404 would be baked in as a
  // permanent static response (build-time env ≠ runtime env). Reading the
  // cookie jar first terminates prerendering and defers to request-time
  // rendering. (`_request` is unused; `cookies()` reads the request.)
  void _request
  const jar = await cookies()
  const provider = getDashboardProvider()
  if (!provider) {
    return nextRouteResponse.toNextResponse(
      routeResult.error(
        404,
        "Dashboard SSO is not configured. Set DASHBOARD_ORIGIN.",
      ),
    )
  }

  // Forward the browser's full cookie jar: cookies are host-scoped (not
  // port-scoped), so this includes the Dashboard's Better Auth session
  // cookie when the Dashboard runs on the same host on another port.
  const cookieHeader = jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ")

  try {
    const url = await loginWithDashboardSession(
      cookieHeader,
      provider.dashboardOrigin,
    )
    return nextRouteResponse.toNextResponse(routeResult.ok({ url }))
  } catch (error) {
    if (error instanceof DashboardLoginError) {
      const status = error.code === "email-collision" ? 409 : 401
      return nextRouteResponse.toNextResponse(
        routeResult.error(status, error.message),
      )
    }
    return nextRouteResponse.toNextResponse(
      routeResult.error(500, "Could not log in with the Dashboard."),
    )
  }
}
