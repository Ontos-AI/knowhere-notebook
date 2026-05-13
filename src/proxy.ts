import { NextResponse, type NextRequest } from "next/server"
import { authURLs } from "@/infrastructure/auth/urls"
import { sessionCookieNames } from "@/infrastructure/auth/session-cookie-names"
import { knowhereApiKeyOverride } from "@/integrations/knowhere-api-key"

/**
 * Edge-runtime proxy (renamed from middleware.ts in Next.js 16).
 *
 * Purpose: cheap short-circuit for obviously-anonymous requests to
 * protected routes. If no session cookie is present, redirect to the
 * Dashboard login page without making any DB or upstream calls.
 *
 * This is NOT the authoritative auth check. A present cookie is never
 * trusted here — the real verification happens in `src/infrastructure/auth`.
 * via the Dashboard oRPC lookup. The proxy only catches the easy case
 * where there's nothing to verify.
 */

/**
 * Routes that stay accessible without a session. Everything else under
 * `/` is considered app-protected and will redirect to Dashboard login
 * when no cookie is present.
 */
const PUBLIC_PATHS: readonly string[] = [
  "/",
  "/login",
  "/favicon.ico",
  "/api/internal/health",
  "/api/sources/reconcile",
]

const STATIC_EXTENSIONS = /\.(?:svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|css|js|map|txt|xml|webmanifest|json|pdf)$/i
const GUEST_SOURCE_CHUNKS_PATH = /^\/api\/sources\/[^/]+\/chunks$/u
const GUEST_DEMO_ORIGINAL_PATH = /^\/api\/demo-sources\/[^/]+\/original$/u
const GUEST_DEMO_ASSET_PATH = /^\/api\/demo-sources\/[^/]+\/assets\/.+$/u

function isPublicPath(req: NextRequest): boolean {
  const pathname = req.nextUrl.pathname
  if (isGuestSourceReadPath(req.method, pathname)) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname.startsWith("/api/internal/")) return true
  if (STATIC_EXTENSIONS.test(pathname)) return true
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

function isGuestSourceReadPath(method: string, pathname: string): boolean {
  if (method !== "GET") return false
  return (
    pathname === "/api/sources" ||
    GUEST_SOURCE_CHUNKS_PATH.test(pathname) ||
    GUEST_DEMO_ORIGINAL_PATH.test(pathname) ||
    GUEST_DEMO_ASSET_PATH.test(pathname)
  )
}

export function proxy(req: NextRequest): NextResponse {
  if (knowhereApiKeyOverride.hasApiKey()) return NextResponse.next()

  if (isPublicPath(req)) return NextResponse.next()

  for (const name of sessionCookieNames()) {
    if (req.cookies.get(name)) return NextResponse.next()
  }

  const origin = process.env.DASHBOARD_ORIGIN
  if (!origin) {
    return NextResponse.redirect(new URL("/login", req.url))
  }
  const loginUrl = `${origin}/login`

  const notebookUrl =
    process.env.NOTEBOOK_PUBLIC_URL ?? new URL(req.url).origin
  return NextResponse.redirect(
    authURLs.buildDashboardLoginURL(loginUrl, notebookUrl),
  )
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|login|favicon.ico).*)",
  ],
}
