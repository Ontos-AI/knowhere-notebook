import { NextResponse, type NextRequest } from "next/server"

import { getOAuthProvider } from "@/infrastructure/auth/oauth-providers"
import { completeOAuthLogin } from "@/infrastructure/auth/oauth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: providerName } = await params
  const provider = getOAuthProvider(providerName)
  if (!provider) {
    return NextResponse.redirect(new URL("/login?error=provider", request.url))
  }

  const url = new URL(request.url)
  const code = url.searchParams.get("code") ?? ""
  const state = url.searchParams.get("state") ?? ""
  const callbackUrl = `${url.origin}/api/auth/${provider.name}/callback`

  try {
    const destination = await completeOAuthLogin(
      provider,
      callbackUrl,
      code,
      state,
    )
    return NextResponse.redirect(new URL(destination, request.url))
  } catch {
    return NextResponse.redirect(
      new URL("/login?error=oauth", request.url),
    )
  }
}
