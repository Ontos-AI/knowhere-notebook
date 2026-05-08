import "server-only"

import { and, eq } from "drizzle-orm"
import { Schema } from "effect"

import { db } from "./db"
import { apiKeys, type ApiKey } from "./schema"

/**
 * Shape of the Dashboard provisioning response (oRPC envelope).
 * `{ json: { id: string; key: string; name: string } }`
 */
const NotebookProvisionResponse = Schema.Struct({
  json: Schema.Struct({
    id: Schema.String,
    key: Schema.String,
    name: Schema.String,
  }),
})

/**
 * Request a per-user Knowhere API key from Dashboard's provisioning
 * endpoint. Notebook never calls Knowhere `/v1/auth/create` directly —
 * Dashboard owns JWT signing and Knowhere knows to trust that JWT.
 *
 * Returns the Knowhere key id and secret for local DB storage.
 */
export async function fetchNotebookApiKeyFromDashboard(
  cookieHeader: string,
): Promise<{ knowhereKeyId: string; apiKey: string }> {
  const url = process.env.DASHBOARD_NOTEBOOK_API_KEY_URL
  if (!url) {
    throw new Error(
      "DASHBOARD_NOTEBOOK_API_KEY_URL must be set. " +
        "It should point to Dashboard's provisionNotebookApiKey oRPC endpoint " +
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
      `Dashboard Notebook API key provisioning failed (${response.status}): ${text}`,
    )
  }

  const body: unknown = await response.json()
  const parsed = Schema.decodeUnknownEither(NotebookProvisionResponse)(body)

  if (parsed._tag === "Left") {
    throw new Error(
      `Unexpected Dashboard provisioning response: ${JSON.stringify(body)}`,
    )
  }

  return {
    knowhereKeyId: parsed.right.json.id,
    apiKey: parsed.right.json.key,
  }
}

/**
 * Idempotent: returns the active API key for the workspace, requesting
 * one from Dashboard's provisioning endpoint if none exists or the
 * existing one is failed. The cookie header must be the raw Cookie
 * string from the incoming request (Dashboard session cookie).
 *
 * Notebook never calls Knowhere `/v1/auth/create` — Dashboard owns JWT
 * signing and the Knowhere key-creation path.
 */
export async function ensureApiKeyForWorkspace(
  workspaceId: string,
  cookieHeader: string,
): Promise<string> {
  const existing = await getActiveApiKeyForWorkspace(workspaceId)
  if (existing) return existing.apiKey

  const created = await fetchNotebookApiKeyFromDashboard(cookieHeader)

  await db
    .insert(apiKeys)
    .values({
      workspaceId,
      knowhereKeyId: created.knowhereKeyId,
      apiKey: created.apiKey,
      name: "Notebook",
      status: "active",
    })
    .onConflictDoNothing({ target: apiKeys.workspaceId })

  // Re-query to get whichever row won the race (ours or a concurrent insert).
  const row = await getActiveApiKeyForWorkspace(workspaceId)
  if (row) return row.apiKey

  throw new Error(
    "ensureApiKeyForWorkspace: API key was just created but could not be " +
      "retrieved. Check that the api_keys.workspace_id unique index exists.",
  )
}

/**
 * Fetch the active API key for a workspace. Returns `null` when no active
 * key exists (missing or failed).
 */
export async function getActiveApiKeyForWorkspace(
  workspaceId: string,
): Promise<ApiKey | null> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.workspaceId, workspaceId),
        eq(apiKeys.status, "active"),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Mark the workspace's API key as failed (e.g. revoked or disabled on the
 * Knowhere side). The UI surfaces this so the user can recreate it.
 */
export async function markApiKeyFailed(workspaceId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ status: "failed" })
    .where(eq(apiKeys.workspaceId, workspaceId))
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

/**
 * Wrap a Knowhere SDK operation so auth errors mark the workspace's
 * API key as failed before re-throwing. Non-auth errors pass through
 * untouched.
 */
export async function withApiKeyErrorHandling<T>(
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isAuthError(error)) {
      await markApiKeyFailed(workspaceId)
    }
    throw error
  }
}

/**
 * Look up the API key status for a workspace. Used by the UI to decide
 * whether to show the recreate prompt. Queries without status filter
 * so we can distinguish "missing" from "failed".
 */
export async function getApiKeyStatus(
  workspaceId: string,
): Promise<"active" | "failed" | "missing"> {
  const [row] = await db
    .select({ status: apiKeys.status })
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .limit(1)
  if (!row) return "missing"
  if (row.status === "failed") return "failed"
  return "active"
}
