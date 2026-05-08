import "server-only"

import { and, eq } from "drizzle-orm"
import { Schema } from "effect"

import { db } from "./db"
import { apiKeys, type ApiKey } from "./schema"

const KnowhereKeyResponse = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
})
const KNOWHERE_CREATE_URL = "/v1/auth/create"

/**
 * Create an API key on the Knowhere side by forwarding the Dashboard
 * session cookie. Returns the parsed key id and secret.
 */
async function createApiKeyViaKnowhere(
  cookieHeader: string,
): Promise<{ knowhereKeyId: string; apiKey: string }> {
  const baseURL = process.env.KNOWHERE_BASE_URL
  if (!baseURL) {
    throw new Error("KNOWHERE_BASE_URL must be set to create an API key.")
  }

  const response = await fetch(`${baseURL}${KNOWHERE_CREATE_URL}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
    },
    body: JSON.stringify({ name: "Notebook" }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `Knowhere API key creation failed (${response.status}): ${text}`,
    )
  }

  const body: unknown = await response.json()
  const parsed = Schema.decodeUnknownEither(KnowhereKeyResponse)(body)

  if (parsed._tag === "Left") {
    throw new Error(
      `Unexpected Knowhere API key response: ${JSON.stringify(body)}`,
    )
  }

  return { knowhereKeyId: parsed.right.id, apiKey: parsed.right.key }
}

/**
 * Idempotent: returns the active API key for the workspace, creating one
 * via Knowhere if none exists or the existing one is failed. The cookie
 * header must be the raw Cookie string from the incoming request
 * (Dashboard session cookie).
 */
export async function ensureApiKeyForWorkspace(
  workspaceId: string,
  cookieHeader: string,
): Promise<string> {
  const existing = await getActiveApiKeyForWorkspace(workspaceId)
  if (existing) return existing.apiKey

  const created = await createApiKeyViaKnowhere(cookieHeader)

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
