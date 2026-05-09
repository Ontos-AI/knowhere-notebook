import "server-only"

import { Effect, Either, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import { logger } from "./logger"

/**
 * Shape of the Dashboard JWT issuance response (oRPC envelope).
 * `{ json: { token: string; expiresInSeconds: number } }`
 */
const JwtResponse = Schema.Struct({
  json: Schema.Struct({
    token: Schema.String.pipe(Schema.minLength(1)),
    expiresInSeconds: Schema.Number,
  }),
})

/**
 * Request a short-lived Knowhere JWT from Dashboard's generic issuance
 * endpoint. The returned token is passed directly to the Knowhere SDK
 * as `apiKey` — no persistent API key is created or stored.
 *
 * Notebook never calls Knowhere `/v1/auth/create`. Dashboard owns JWT
 * signing; Knowhere validates the JWT via Dashboard JWKS.
 */
export const fetchKnowhereJwtEffect = (cookieHeader: string) =>
  Effect.gen(function* () {
    const origin = process.env.DASHBOARD_ORIGIN
    if (!origin) {
      return yield* Effect.die(
        new Error(
          "DASHBOARD_ORIGIN must be set. " +
            "It should point to the Dashboard origin (see .env.local.example).",
        ),
      )
    }

    const http = yield* HttpClient.HttpClient
    const url = `${origin}/api/orpc/users/issueServiceJwt`
    const body = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeader("content-type", "application/json"),
      HttpClientRequest.setHeader("cookie", cookieHeader),
      HttpClientRequest.bodyText("{}"),
      http.execute,
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          const status = response.status

          if (status < 200 || status >= 300) {
            const rawText = yield* Effect.either(response.text)
            return yield* Effect.die(
              new Error(
                `Dashboard JWT issuance: non-2xx (status=${status}) body=${Either.getOrElse(rawText, () => "").slice(0, 1000)}`,
              ),
            )
          }

          const parsed = yield* Effect.either(response.json)
          if (Either.isLeft(parsed)) {
            return yield* Effect.die(
              new Error(
                `Dashboard JWT issuance: invalid JSON (status=${status}) error=${String(parsed.left)}`,
              ),
            )
          }

          const result = Schema.decodeUnknownEither(JwtResponse)(parsed.right)
          if (Either.isLeft(result)) {
            return yield* Effect.die(
              new Error(
                `Dashboard JWT issuance: schema mismatch (status=${status}) body=${String(parsed.right).slice(0, 1000)}`,
              ),
            )
          }

          return result.right
        }),
      ),
    )

    return body.json.token
  })

/**
 * Async wrapper for Next.js boundary callers.
 */
export async function fetchKnowhereJwt(
  cookieHeader: string,
): Promise<string> {
  const start = Date.now()
  try {
    const token = await Effect.runPromise(
      fetchKnowhereJwtEffect(cookieHeader).pipe(
        Effect.provide(FetchHttpClient.layer),
      ),
    )
    logger.info("dashboard: POST /api/orpc/users/issueServiceJwt ok", {
      durationMs: Date.now() - start,
    })
    return token
  } catch (error) {
    logger.error("dashboard: POST /api/orpc/users/issueServiceJwt failed", {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Fetch a per-request Knowhere JWT from Dashboard, forwarding the
 * incoming session cookie.
 */
export async function ensureApiKeyForWorkspace(
  _workspaceId: string,
  cookieHeader: string,
): Promise<string> {
  return fetchKnowhereJwt(cookieHeader)
}

/**
 * Heuristic: classify an error thrown by the Knowhere SDK or fetch as
 * auth-related (401/403). Covers the SDK's error shape and raw fetch
 * Response objects.
 */
export function isAuthError(error: unknown): boolean {
  if (error instanceof Response) {
    return error.status === 401 || error.status === 403
  }
  const err = error as Record<string, unknown> | null | undefined
  if (!err) return false
  if (typeof err.status === "number") {
    if (err.status === 401 || err.status === 403) return true
  }
  if (typeof err.statusCode === "number") {
    if (err.statusCode === 401 || err.statusCode === 403) return true
  }
  if (typeof err.message === "string") {
    const msg = err.message.toLowerCase()
    if (msg.includes("401") || msg.includes("403")) return true
    if (
      msg.includes("unauthorized") ||
      msg.includes("unauthenticated") ||
      msg.includes("forbidden") ||
      msg.includes("invalid api key") ||
      msg.includes("auth error")
    )
      return true
  }
  return false
}
