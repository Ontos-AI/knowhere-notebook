import type { NextRequest, NextResponse } from "next/server"

import { getOAuthProvider } from "@/infrastructure/auth/oauth-providers"
import { buildOAuthAuthorizeUrl } from "@/infrastructure/auth/oauth"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: providerName } = await params
  const provider = getOAuthProvider(providerName)
  if (!provider) {
    return nextRouteResponse.toNextResponse(
      routeResult.error(404, `OAuth provider '${providerName}' is not configured.`),
    )
  }

  const url = new URL(request.url)
  const callbackUrl = `${url.origin}/api/auth/${provider.name}/callback`
  const { url: authorizeUrl } = await buildOAuthAuthorizeUrl(provider, callbackUrl)
  return nextRouteResponse.toNextResponse(
    routeResult.ok({ url: authorizeUrl }),
  )
}
