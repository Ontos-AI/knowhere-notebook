import "server-only"

import { cookies } from "next/headers"
import { Effect } from "effect"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { sessionsRepository } from "./sessions-repository"
import { notebookSessionCookieName } from "./session-cookie-constants"

/** Cookie holding the DB session id. */
export const sessionCookieName = notebookSessionCookieName

/** Session lifetime: 30 days. */
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000

export type SessionDurations = {
  readonly createdAt: Date
  readonly expiresAt: Date
}

function getCookieOptions(): {
  readonly httpOnly: true
  readonly sameSite: "lax"
  readonly secure: boolean
  readonly path: "/"
  readonly maxAge: number
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionLifetimeMs / 1000,
  }
}

/**
 * Create a DB session row for the user and set the `notebook-session`
 * cookie. Server Action / Route Handler only (Next 16 constraint: cookies
 * cannot be set from Server Components).
 */
export async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + sessionLifetimeMs)
  const session = await databaseRuntime.runPromise(
    sessionsRepository.createEffect({ userId, expiresAt }),
  )
  const jar = await cookies()
  jar.set(sessionCookieName, session.id, getCookieOptions())
  return session.id
}

/**
 * Delete the session row behind the current `notebook-session` cookie and
 * clear the cookie. Safe to call when no session exists.
 */
export async function deleteSession(): Promise<void> {
  const jar = await cookies()
  const sessionId = jar.get(sessionCookieName)?.value
  if (sessionId) {
    await databaseRuntime
      .runPromise(sessionsRepository.deleteByIdEffect(sessionId))
      .catch(() => {})
  }
  jar.delete(sessionCookieName)
}

/**
 * Read the session id from the cookie without touching the DB. Used by the
 * edge proxy for the cheap presence check.
 */
export async function getSessionIdFromCookie(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(sessionCookieName)?.value ?? null
}

/**
 * Opportunistically sweep expired sessions. Best-effort; failures are
 * swallowed so login is never blocked by a cleanup hiccup.
 */
export function sweepExpiredSessions(): Promise<void> {
  return databaseRuntime
    .runPromise(sessionsRepository.deleteExpiredEffect())
    .catch(() => {})
}

export const sessionEffect = {
  create: (userId: string): Effect.Effect<string, unknown, never> =>
    Effect.tryPromise(() => createSession(userId)),
} as const
