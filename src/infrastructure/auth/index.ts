import "server-only"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Context, Effect, Layer } from "effect"

import { logger } from "@/lib/logger"
import { sessionCookieName } from "./session"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { sessionsRepository } from "./sessions-repository"
import { usersRepository } from "./users-repository"
import { formatUnknownForLog } from "@/lib/format-log-value"

export { sessionCookieName } from "./session"
export { notebookSessionCookieName } from "./session-cookie-constants"

/**
 * Auth helpers for Knowhere Notebook (Phase 2+: Notebook-owned auth).
 *
 * Design:
 *   - Identity is Notebook-owned: a DB-backed session row keyed by the
 *     `notebook-session` cookie, joined to the `users` table.
 *   - `user === null` means "unauthenticated".
 */

// ---- Schema ---------------------------------------------------------------

export type AuthUser = {
  readonly id: string
  readonly email: string | null
  readonly name: string | null
}

// ---- Session lookup -------------------------------------------------------

function findUserBySessionCookie(cookieHeader: string): Promise<AuthUser | null> {
  const sessionId = parseSessionIdFromCookieHeader(cookieHeader)
  if (!sessionId) return Promise.resolve(null)

  return databaseRuntime
    .runPromise(
      Effect.gen(function* () {
        const session = yield* sessionsRepository.findByIdEffect(sessionId)
        if (!session) return null
        const user = yield* usersRepository.findByIdEffect(session.userId)
        if (!user) return null
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
        }
      }),
    )
    .catch(() => null)
}

function parseSessionIdFromCookieHeader(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name === sessionCookieName) {
      const value = rest.join("=").trim()
      return value.length > 0 ? decodeURIComponent(value) : null
    }
  }
  return null
}

// ---- Auth Service ---------------------------------------------------------

export const Auth = Context.GenericTag<{
  readonly getCurrentUser: () => Effect.Effect<AuthUser | null>
}>("@knowhere/Auth")

export const authLayer = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const getCurrentUser = () => getCurrentUserEffect
    return { getCurrentUser }
  }),
)

// ---- Public API (Promise-based, for Next.js compatibility) ----------------

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieHeader = (await headers()).get("cookie") ?? ""
  if (cookieHeader.length === 0) {
    logger.info("auth: getCurrentUser skipped (no session cookie)")
    return null
  }

  const start = Date.now()
  const user = await findUserBySessionCookie(cookieHeader)

  if (user === null) {
    logger.info("auth: getCurrentUser -> no valid session", {
      durationMs: Date.now() - start,
    })
  } else {
    logger.info("auth: getCurrentUser ok", {
      userId: user.id,
      durationMs: Date.now() - start,
    })
  }

  return user
}

export const getCurrentUserEffect: Effect.Effect<AuthUser | null, never> =
  Effect.tryPromise(() => getCurrentUser()).pipe(Effect.catchAll(() => Effect.succeed(null)))

/**
 * Page / server-action guard. Redirects to the local login page with a
 * `callbackURL` pointing back at the Notebook public URL when the caller
 * is unauthenticated.
 *
 * Throws a Next.js redirect; callers never see the anonymous branch.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser()
  if (user !== null) return user

  redirect("/login")
}

/**
 * Cheap cookie-presence check usable from the edge proxy. Does not touch
 * the DB; used to short-circuit obvious anonymous requests. Always
 * re-verify on the server with `getCurrentUser` / `requireUser`.
 */
export async function hasSessionCookie(): Promise<boolean> {
  const jar = await import("next/headers").then(({ cookies }) => cookies())
  return jar.get(sessionCookieName) !== undefined
}

/**
 * Extract a user object from a raw lookup result. Kept for parity with the
 * previous Dashboard envelope parsing; returns null for non-conforming input.
 */
export function extractUser(value: unknown): AuthUser | null {
  if (typeof value !== "object" || value === null) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return null
  return {
    id: candidate.id,
    email: typeof candidate.email === "string" ? candidate.email : null,
    name: typeof candidate.name === "string" ? candidate.name : null,
  }
}

export function formatAuthError(error: unknown): string {
  return formatUnknownForLog(error)
}
