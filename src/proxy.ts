import { NextResponse, type NextRequest } from "next/server"
import { notebookSessionCookieName } from "@/infrastructure/auth/session-cookie-constants"

/**
 * Edge-runtime proxy (renamed from middleware.ts in Next.js 16).
 *
 * Purpose: cheap short-circuit for obviously-anonymous requests to
 * protected routes. If no session cookie is present, redirect to the
 * local login page without making any DB or upstream calls.
 *
 * This is NOT the authoritative auth check. A present cookie is never
 * trusted here — the real verification happens in `src/infrastructure/auth`
 * via the DB session lookup. The proxy only catches the easy case where
 * there's nothing to verify.
 */

/**
 * Routes that stay accessible without a session. Everything else under
 * `/` is considered app-protected and will redirect to login when no
 * cookie is present.
 */
const PUBLIC_PATHS: readonly string[] = [
  "/",
  "/login",
  "/favicon.ico",
  "/api/internal/health",
  "/api/sources/reconcile",
  "/api/auth",
]

const STATIC_EXTENSIONS = /\.(?:svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|css|js|map|txt|xml|webmanifest|json|pdf)$/i

function isPublicPath(req: NextRequest): boolean {
  const pathname = req.nextUrl.pathname
  if (pathname.startsWith("/_next")) return true
  if (pathname.startsWith("/api/internal/")) return true
  if (STATIC_EXTENSIONS.test(pathname)) return true
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

export function proxy(req: NextRequest): NextResponse {
  if (isPublicPath(req)) return NextResponse.next()

  if (req.cookies.get(notebookSessionCookieName)) return NextResponse.next()

  return NextResponse.redirect(new URL("/login", req.url))
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|login|favicon.ico).*)",
  ],
}
