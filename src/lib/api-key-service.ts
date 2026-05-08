import "server-only"

import { Schema } from "effect"

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
export async function fetchKnowhereJwt(
  cookieHeader: string,
): Promise<string> {
  const url = process.env.DASHBOARD_KNOWHERE_TOKEN_URL
  if (!url) {
    throw new Error(
      "DASHBOARD_KNOWHERE_TOKEN_URL must be set. " +
        "It should point to Dashboard's issueServiceJwt oRPC endpoint " +
        "(see .env.local.example).",
    )
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
    },
    body: "{}",
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `Dashboard JWT issuance failed (${response.status}): ${text}`,
    )
  }

  const body: unknown = await response.json()
  const parsed = Schema.decodeUnknownEither(JwtResponse)(body)

  if (parsed._tag === "Left") {
    throw new Error(
      `Unexpected Dashboard JWT response: ${JSON.stringify(body)}`,
    )
  }

  return parsed.right.json.token
}

/**
 * Fetch a per-request Knowhere JWT from Dashboard, forwarding the
 * incoming session cookie. No persistent API key is created or stored.
 */
export async function ensureApiKeyForWorkspace(
  _workspaceId: string,
  cookieHeader: string,
): Promise<string> {
  return fetchKnowhereJwt(cookieHeader)
}

/**
 * No-op preserved for backward compat. JWT tokens are per-request and
 * not stored — there is no key row to mark as failed. When the JWT
 * expires the next request fetches a fresh one from Dashboard.
 */
export async function markApiKeyFailed(_workspaceId: string): Promise<void> {
  // no-op: JWT tokens are ephemeral
}

/**
 * Return "active" for backward compat. JWT tokens are fetched fresh
 * per request and not stored in a local key table.
 */
export async function getApiKeyStatus(
  _workspaceId: string,
): Promise<"active" | "failed" | "missing"> {
  return "active"
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
