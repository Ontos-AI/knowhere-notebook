import "server-only"

import { Effect, Either, Schema } from "effect"
import { cacheLife, cacheTag } from "next/cache"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { logger } from "@/lib/logger"
import { knowhereApiKeyOverride } from "@/integrations/knowhere-api-key"
import { setEmptyJsonBody, setJsonBody } from "./orpc-request"
import { formatUnknownForLog } from "@/lib/format-log-value"

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

const ISSUE_JWT_PATH = "/api/orpc/users/issueServiceJwt"
const REFRESH_JWT_PATH = "/api/orpc/knowhereServiceJwt/refresh"

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
    const url = `${origin}${ISSUE_JWT_PATH}`
    const body = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeader("cookie", cookieHeader),
      setEmptyJsonBody,
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
                `Dashboard JWT issuance: schema mismatch (status=${status}) body=${formatUnknownForLog(parsed.right).slice(0, 1000)}`,
              ),
            )
          }

          return result.right
        }),
      ),
    )

    return body.json
  })

type KnowhereJwt = {
  readonly token: string
  readonly expiresInSeconds: number
}

const minimumJwtCacheSeconds = 30
const jwtExpirationSafetySeconds = 15
const maximumJwtRefreshSeconds = 60

// Cache only inside the issued JWT's lifetime. The cache profile is computed
// after Dashboard responds so short-lived JWTs cannot outlive their expiration.
async function fetchKnowhereJwtCached(
  cookieHeader: string,
): Promise<KnowhereJwt> {
  "use cache"
  cacheTag("knowhere-jwt")

  const jwt = await Effect.runPromise(
    fetchKnowhereJwtEffect(cookieHeader).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  )
  const cacheSeconds = normalizeJwtCacheSeconds(jwt.expiresInSeconds)
  cacheLife(getJwtCacheLife(cacheSeconds))

  return jwt
}

/**
 * Async wrapper for Next.js boundary callers.
 */
export async function fetchKnowhereJwt(
  cookieHeader: string,
): Promise<string> {
  const start = Date.now()
  try {
    const jwt = await fetchKnowhereJwtCached(cookieHeader)
    logger.info("dashboard: POST /api/orpc/users/issueServiceJwt ok", {
      durationMs: Date.now() - start,
    })
    return jwt.token
  } catch (error) {
    logger.error("dashboard: POST /api/orpc/users/issueServiceJwt failed", {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export const refreshKnowhereJwtEffect = (token: string) =>
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
    const url = `${origin}${REFRESH_JWT_PATH}`
    const body = yield* setJsonBody(HttpClientRequest.post(url), {
      json: { token },
    }).pipe(
      http.execute,
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          const status = response.status

          if (status < 200 || status >= 300) {
            const rawText = yield* Effect.either(response.text)
            return yield* Effect.die(
              new Error(
                `Dashboard JWT refresh: non-2xx (status=${status}) body=${Either.getOrElse(rawText, () => "").slice(0, 1000)}`,
              ),
            )
          }

          const parsed = yield* Effect.either(response.json)
          if (Either.isLeft(parsed)) {
            return yield* Effect.die(
              new Error(
                `Dashboard JWT refresh: invalid JSON (status=${status}) error=${String(parsed.left)}`,
              ),
            )
          }

          const result = Schema.decodeUnknownEither(JwtResponse)(parsed.right)
          if (Either.isLeft(result)) {
            return yield* Effect.die(
              new Error(
                `Dashboard JWT refresh: schema mismatch (status=${status}) body=${formatUnknownForLog(parsed.right).slice(0, 1000)}`,
              ),
            )
          }

          return result.right.json.token
        }),
      ),
    )

    return body
  })

export async function refreshKnowhereJwt(token: string): Promise<string> {
  const start = Date.now()
  try {
    const refreshed = await Effect.runPromise(
      refreshKnowhereJwtEffect(token).pipe(
        Effect.provide(FetchHttpClient.layer),
      ),
    )
    logger.info("dashboard: POST /api/orpc/knowhereServiceJwt/refresh ok", {
      durationMs: Date.now() - start,
    })
    return refreshed
  } catch (error) {
    logger.error("dashboard: POST /api/orpc/knowhereServiceJwt/refresh failed", {
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export type EnsureFreshKnowhereApiKeyOptions = {
  readonly force?: boolean
}

/**
 * Keep a QStash-stored Knowhere credential usable across long workflows.
 * Dashboard JWTs last one hour; this refreshes when the snapshot is within
 * the safety window, already expired, or `force` is set. Persistent API keys
 * are returned unchanged.
 */
export async function ensureFreshKnowhereApiKey(
  apiKey: string,
  options: EnsureFreshKnowhereApiKeyOptions = {},
): Promise<string> {
  const override = knowhereApiKeyOverride.getApiKey()
  if (override && apiKey === override) return apiKey
  if (!looksLikeJwt(apiKey)) return apiKey
  if (!options.force && !shouldRefreshKnowhereJwt(apiKey)) return apiKey
  return refreshKnowhereJwt(apiKey)
}

export async function withFreshKnowhereApiKey<T>(
  apiKey: string,
  run: (apiKey: string) => Promise<T>,
): Promise<{ readonly result: T; readonly apiKey: string }> {
  let current = await ensureFreshKnowhereApiKey(apiKey)
  try {
    return { result: await run(current), apiKey: current }
  } catch (error) {
    if (!isAuthError(error)) throw error
    current = await ensureFreshKnowhereApiKey(current, { force: true })
    return { result: await run(current), apiKey: current }
  }
}

export function shouldRefreshKnowhereJwt(
  apiKey: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const expiresAt = readJwtExpirySeconds(apiKey)
  if (expiresAt === null) return false
  return expiresAt - nowSeconds <= jwtExpirationSafetySeconds
}

export function looksLikeJwt(apiKey: string): boolean {
  return apiKey.split(".").length === 3
}

const JwtExpiryPayload = Schema.Struct({
  exp: Schema.Number,
})

export function readJwtExpirySeconds(apiKey: string): number | null {
  const parts = apiKey.split(".")
  const payloadSegment = parts[1]
  if (parts.length !== 3 || payloadSegment === undefined) return null
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    )
    const decoded = Schema.decodeUnknownEither(JwtExpiryPayload)(parsed)
    return Either.isRight(decoded) ? decoded.right.exp : null
  } catch {
    return null
  }
}

/**
 * Resolve the credential used for Knowhere SDK calls. Development can
 * short-circuit Dashboard JWT issuance by setting KNOWHERE_API_KEY.
 */
export async function ensureApiKeyForWorkspace(
  _workspaceId: string,
  cookieHeader: string,
): Promise<string> {
  const apiKey = knowhereApiKeyOverride.getApiKey()
  if (apiKey) return apiKey

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
      msg.includes("authentication required") ||
      msg.includes("forbidden") ||
      msg.includes("invalid api key") ||
      msg.includes("auth error")
    )
      return true
  }
  if (typeof err.name === "string") {
    const name = err.name.toLowerCase()
    if (name.includes("authentication") || name.includes("unauthorized")) {
      return true
    }
  }
  return false
}

function normalizeJwtCacheSeconds(expiresInSeconds: number): number {
  if (!Number.isFinite(expiresInSeconds)) return minimumJwtCacheSeconds
  return Math.max(1, Math.floor(expiresInSeconds))
}

function getJwtCacheLife(expiresInSeconds: number): {
  readonly stale: number
  readonly revalidate: number
  readonly expire: number
} {
  const refreshSeconds = Math.max(
    1,
    Math.min(
      maximumJwtRefreshSeconds,
      expiresInSeconds - jwtExpirationSafetySeconds,
    ),
  )
  return {
    stale: refreshSeconds,
    revalidate: refreshSeconds,
    expire: expiresInSeconds,
  }
}
