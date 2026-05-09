import "server-only"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { Context, Effect, Either, Layer, Schedule, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { authURLs } from "./auth-urls"
import { sessionCookieNames } from "./session-cookie-names"
import { logger } from "./logger"
import { setEmptyJsonBody } from "./dashboard-orpc-request"
import { formatUnknownForLog } from "./format-log-value"

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

const DASHBOARD_SESSION_TIMEOUT_MS = 3_000

// ---- Effect implementation ------------------------------------------------

export const getCurrentUserEffect = Effect.gen(function* () {
  const origin = process.env.DASHBOARD_ORIGIN
  if (!origin) {
    return yield* Effect.die(
      new Error(
        "DASHBOARD_ORIGIN is required. Set it to the Dashboard origin " +
        "(see .env.local.example).",
      ),
    )
  }

  const cookieHeader = (yield* Effect.promise(() => headers())).get("cookie") ?? ""
  if (cookieHeader.length === 0) return null

  const http = yield* HttpClient.HttpClient
  const url = `${origin}/api/orpc/users/getCurrentUser`
  const body = yield* HttpClientRequest.post(url).pipe(
    HttpClientRequest.setHeader("cookie", cookieHeader),
    setEmptyJsonBody,
    http.execute,
    Effect.flatMap((response) =>
      Effect.gen(function* () {
        const status = response.status

        if (status < 200 || status >= 300) {
          const rawText = yield* Effect.either(response.text)
          logger.warn(
            "dashboard: POST /api/orpc/users/getCurrentUser -> non-2xx",
            { status, body: Either.getOrElse(rawText, () => "").slice(0, 1000) },
          )
          return null
        }

        const parsed = yield* Effect.either(response.json)
        if (Either.isLeft(parsed)) {
          logger.warn(
            "dashboard: POST /api/orpc/users/getCurrentUser -> invalid JSON",
            { status, error: String(parsed.left) },
          )
          return null
        }

        const result = Schema.decodeUnknownEither(oRPCEnvelope)(parsed.right)
        if (Either.isLeft(result)) {
          logger.warn(
            "dashboard: POST /api/orpc/users/getCurrentUser -> schema mismatch",
            { status, body: formatUnknownForLog(parsed.right).slice(0, 1000) },
          )
          return null
        }

        return result.right.json.user
      }),
    ),
    Effect.timeout(DASHBOARD_SESSION_TIMEOUT_MS),
    Effect.catchAll((err) => {
      logger.warn(
        "dashboard: POST /api/orpc/users/getCurrentUser -> failed",
        { error: String(err) },
      )
      return Effect.succeed(null)
    }),
  )

  return body
})

// ---- Auth Service ---------------------------------------------------------

export const Auth = Context.GenericTag<
  { readonly getCurrentUser: () => Effect.Effect<AuthUser | null> }
>("@knowhere/Auth")

export const authLayer = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({
        schedule: Schedule.exponential(100),
        times: 2,
      }),
    )
    const getCurrentUser = () => getCurrentUserEffect.pipe(Effect.provideService(HttpClient.HttpClient, http))
    return { getCurrentUser }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))

// ---- Public API (Promise-based, for Next.js compatibility) ----------------

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieHeader = (await headers()).get("cookie") ?? ""
  if (cookieHeader.length === 0) {
    logger.info("dashboard: POST /api/orpc/users/getCurrentUser skipped (no session cookie)")
    return null
  }

  const start = Date.now()
  const user = await Effect.runPromise(
    getCurrentUserEffect.pipe(Effect.provide(FetchHttpClient.layer)),
  )

  if (user === null) {
    logger.info("dashboard: POST /api/orpc/users/getCurrentUser -> no valid session", {
      durationMs: Date.now() - start,
    })
  } else {
    logger.info("dashboard: POST /api/orpc/users/getCurrentUser ok", {
      userId: user.id,
      durationMs: Date.now() - start,
    })
  }

  return user
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
