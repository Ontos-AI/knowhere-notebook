import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Auth helpers for Knowhere Notebook.
 *
 * Design (per @Pi's Dashboard investigation):
 *   - Dashboard is the auth source of truth. Notebook never decodes or
 *     verifies a JWT.
 *   - Dashboard sets a Better Auth session cookie on `Domain=.knowhereto.ai`.
 *     Notebook is served from `notebook.knowhereto.ai`, so the cookie arrives
 *     on every request automatically.
 *   - Every server-side check calls `getCurrentUser`, which forwards the
 *     incoming Cookie header to Dashboard's oRPC session lookup
 *     `users.getCurrentUser` and reads `body.json.user`.
 *   - `user === null` (including upstream 4xx/5xx or network failure) means
 *     "unauthenticated" — never try to distinguish failure modes, never
 *     leak upstream errors to the browser.
 */

export type AuthUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

/**
 * Cookie names Better Auth / the Dashboard may set. If any of these is
 * present we bother asking Dashboard. If none are present, we skip the
 * roundtrip and treat the request as anonymous.
 *
 * Extendable via env `SESSION_COOKIE_NAMES` (comma-separated) if Dashboard
 * changes its cookie naming.
 */
const DEFAULT_SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

export function sessionCookieNames(): readonly string[] {
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
 * Server-side session lookup. Returns the authenticated user, or `null`
 * if the session is missing, expired, or Dashboard is unreachable.
 *
 * Do not cache the result across requests — session can expire mid-session.
 * The Next.js request cache makes this effectively a no-op when called
 * multiple times in the same request.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const url = process.env.DASHBOARD_SESSION_URL;
  if (!url) {
    // Missing config is a deployment error, not a runtime one. Fail loudly
    // in server code so we catch it in staging.
    throw new Error(
      "DASHBOARD_SESSION_URL is required. Set it to the Dashboard " +
        "users.getCurrentUser oRPC endpoint (see .env.local.example).",
    );
  }

  const cookieHeader = (await headers()).get("cookie") ?? "";
  if (cookieHeader.length === 0) return null;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json",
      },
      // oRPC expects a JSON body even when the procedure takes no input.
      body: "{}",
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  return extractUser(body);
}

/**
 * Page / server-action guard. Redirects to the Dashboard login page with
 * a `callbackURL` pointing back at the Notebook public URL when the caller
 * is unauthenticated.
 *
 * Throws a Next.js redirect; callers never see the anonymous branch.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (user) return user;

  const loginUrl = process.env.DASHBOARD_LOGIN_URL;
  const notebookUrl = process.env.NOTEBOOK_PUBLIC_URL;
  if (!loginUrl || !notebookUrl) {
    throw new Error(
      "DASHBOARD_LOGIN_URL and NOTEBOOK_PUBLIC_URL must both be set.",
    );
  }

  const url = new URL(loginUrl);
  url.searchParams.set("callbackURL", notebookUrl);
  redirect(url.toString());
}

/**
 * Cheap cookie-presence check usable from middleware (Edge runtime).
 * Does not call Dashboard; used to short-circuit obvious anonymous
 * requests without the round-trip. Always re-verify on the server with
 * `getCurrentUser` / `requireUser` before trusting identity.
 */
export async function hasSessionCookie(): Promise<boolean> {
  const jar = await cookies();
  for (const name of sessionCookieNames()) {
    if (jar.get(name)) return true;
  }
  return false;
}

// ---- internals ---------------------------------------------------------

/**
 * Parse the Dashboard oRPC response envelope `{ json: { user } }`.
 * Tolerant to minor shape drift — any non-object response becomes `null`.
 */
export function extractUser(body: unknown): AuthUser | null {
  if (!isObject(body)) return null;
  const json = (body as Record<string, unknown>).json;
  if (!isObject(json)) return null;
  const user = (json as Record<string, unknown>).user;
  if (!isObject(user)) return null;

  const id = (user as Record<string, unknown>).id;
  if (typeof id !== "string" || id.length === 0) return null;

  const email = (user as Record<string, unknown>).email;
  const name = (user as Record<string, unknown>).name;

  return {
    id,
    email: typeof email === "string" ? email : null,
    name: typeof name === "string" ? name : null,
  };
}

function isObject(v: unknown): v is object {
  return v !== null && typeof v === "object";
}
