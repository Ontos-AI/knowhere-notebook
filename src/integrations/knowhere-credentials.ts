import "server-only"

import { Effect } from "effect"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { workspaceRepository } from "@/domains/workspace/repository"
import { knowhereApiKeysRepository } from "@/infrastructure/auth/knowhere-api-keys-repository"
import { getDefaultKnowhereKey } from "@/integrations/knowhere-keys"

/**
 * Resolve the credential used for Knowhere SDK calls.
 *
 * Order (key-agnostic, user-scoped keys):
 * 1. Active DB key for the workspace (workspaces.active_knowhere_api_key_id)
 *    — decrypted on demand, never logged or sent to the browser.
 * 2. The user's first non-deleted key.
 * 3. File/env fallback (`config/knowhere-keys.json`, then KNOWHERE_API_KEY)
 *    — kept as the bootstrap for fresh deployments before any UI key is
 *    added.
 */
export async function ensureApiKeyForWorkspace(
  workspaceId: string,
): Promise<string> {
  const dbKey = await databaseRuntime
    .runPromise(
      Effect.gen(function* () {
        const workspace = yield* workspaceRepository.findByIdEffect(workspaceId)
        if (!workspace) return null

        const active = yield* knowhereApiKeysRepository.getActiveForWorkspaceEffect(
          workspaceId,
        )
        if (active) return active

        return yield* knowhereApiKeysRepository.firstForUserEffect(
          workspace.userId,
        )
      }),
    )
    .catch(() => null)

  if (dbKey) {
    const apiKey = await databaseRuntime
      .runPromise(knowhereApiKeysRepository.decryptStoredEffect(dbKey))
      .catch(() => null)
    if (apiKey) return apiKey
  }

  const defaultKey = await getDefaultKnowhereKey()
  if (defaultKey) return defaultKey.apiKey

  throw new Error(
    "No Knowhere API key configured. Add one via the API keys dialog, " +
      "set KNOWHERE_API_KEY, or provide config/knowhere-keys.json.",
  )
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
