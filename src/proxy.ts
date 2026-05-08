import { NextResponse, type NextRequest } from "next/server";
import { authURLs } from "./lib/auth-urls";

/**
 * Edge-runtime proxy (renamed from middleware.ts in Next.js 16).
 *
 * Purpose: cheap short-circuit for obviously-anonymous requests to
 * protected routes. If no session cookie is present, redirect to the
 * Dashboard login page without making any DB or upstream calls.
 *
 * This is NOT the authoritative auth check. A present cookie is never
 * trusted here — the real verification happens in `src/lib/auth.ts`
 * via the Dashboard oRPC lookup. The proxy only catches the easy case
 * where there's nothing to verify.
 */

const DEFAULT_SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

function sessionCookieNames(): readonly string[] {
  const override = process.env.SESSION_COOKIE_NAMES;
  if (override && override.trim().length > 0) {
    return override
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_SESSION_COOKIE_NAMES;
}

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
];

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/api/internal/")) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function proxy(req: NextRequest): NextResponse {
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();

  for (const name of sessionCookieNames()) {
    if (req.cookies.get(name)) return NextResponse.next();
  }

  const loginUrl = process.env.DASHBOARD_LOGIN_URL;
  if (!loginUrl) {
    // Misconfigured deploy. Don't silently let users in — send them to
    // the /login preview so the operator notices.
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const notebookUrl =
    process.env.NOTEBOOK_PUBLIC_URL ?? new URL(req.url).origin;
  return NextResponse.redirect(
    authURLs.buildDashboardLoginURL(loginUrl, notebookUrl),
  );
}

export const config = {
  matcher: [
    // Everything except static assets, next internals, and the /login page.
    "/((?!_next/static|_next/image|login|favicon.ico).*)",
  ],
};
