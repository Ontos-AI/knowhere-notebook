import "server-only"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { Context, Effect, Either, Layer, Schema } from "effect"
import { authURLs } from "./auth-urls"
import { sessionCookieNames } from "./session-cookie-names"

export { sessionCookieNames }

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

// ---- Schema ---------------------------------------------------------------

const AuthUserFromORPC = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  email: Schema.Union(Schema.String, Schema.Null).pipe(
    Schema.optionalWith({ default: () => null }),
  ),
  name: Schema.Union(Schema.String, Schema.Null).pipe(
    Schema.optionalWith({ default: () => null }),
  ),
})

export type AuthUser = typeof AuthUserFromORPC.Type

/** oRPC response envelope: `{ json: { user: {...} } }` */
const oRPCEnvelope = Schema.Struct({
  json: Schema.Struct({ user: Schema.Union(AuthUserFromORPC, Schema.Null).pipe(Schema.optionalWith({ default: () => null })) }),
})

// ---- Auth Service ---------------------------------------------------------

export const Auth = Context.GenericTag<
  { readonly getCurrentUser: () => Effect.Effect<AuthUser | null> }
>("@knowhere/Auth")

// ---- Auth Layer (production) ----------------------------------------------

export const authLayer = Layer.succeed(Auth, {
  getCurrentUser: () => Effect.promise(() => getCurrentUser()),
})

// ---- Public API (Promise-based, for Next.js compatibility) ----------------

export async function getCurrentUser(): Promise<AuthUser | null> {
  const origin = process.env.DASHBOARD_ORIGIN
  if (!origin) {
    throw new Error(
      "DASHBOARD_ORIGIN is required. Set it to the Dashboard origin " +
        "(see .env.local.example).",
    )
  }

  const cookieHeader = (await headers()).get("cookie") ?? ""
  if (cookieHeader.length === 0) return null

  const url = `${origin}/api/orpc/users/getCurrentUser`
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        cookie: cookieHeader,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(3_000),
    })
  } catch {
    return null
  }

  if (!res.ok) return null

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return null
  }

  return extractUser(body)
}

/**
 * Page / server-action guard. Redirects to the Dashboard login page with
 * a `callbackURL` pointing back at the Notebook public URL when the caller
 * is unauthenticated.
 *
 * Throws a Next.js redirect; callers never see the anonymous branch.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser()
  if (user !== null) return user

  const origin = process.env.DASHBOARD_ORIGIN
  if (!origin) {
    throw new Error("DASHBOARD_ORIGIN must be set.")
  }

  const loginUrl = `${origin}/login`
  const notebookUrl =
    process.env.NOTEBOOK_PUBLIC_URL ??
    authURLs.resolveNotebookPublicURLFromHeaders(await headers())
  redirect(authURLs.buildDashboardLoginURL(loginUrl, notebookUrl))
}

/**
 * Cheap cookie-presence check usable from middleware (Edge runtime).
 * Does not call Dashboard; used to short-circuit obvious anonymous
 * requests without the round-trip. Always re-verify on the server with
 * `getCurrentUser` / `requireUser` before trusting identity.
 */
export async function hasSessionCookie(): Promise<boolean> {
  const jar = await cookies()
  for (const name of sessionCookieNames()) {
    if (jar.get(name) !== undefined) return true
  }
  return false
}

/**
 * Parse the Dashboard oRPC response envelope `{ json: { user } }`.
 * Tolerant to minor shape drift — any non-conforming response becomes `null`.
 */
export function extractUser(body: unknown): AuthUser | null {
  return Either.getOrElse(
    Either.map(
      Schema.decodeUnknownEither(oRPCEnvelope)(body),
      (envelope) => envelope.json.user,
    ),
    () => null,
  )
}
