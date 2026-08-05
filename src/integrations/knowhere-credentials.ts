import "server-only"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { workspaceRepository } from "@/domains/workspace/repository"
import { knowhereApiKeyOverride } from "@/integrations/knowhere-api-key"
import {
  getDefaultKnowhereKey,
  getKnowhereKeyByLabel,
} from "@/integrations/knowhere-keys"

/**
 * Resolve the credential used for Knowhere SDK calls.
 *
 * Order:
 * 1. Workspace-scoped key: look up the workspace row, read its
 *    `knowhereKeyLabel` (null → default), and resolve the key from the
 *    configured key source (`config/knowhere-keys.json`, falling back to
 *    the KNOWHERE_API_KEY env var). Keys are read server-side only.
 * 2. Legacy env override: single KNOWHERE_API_KEY when no key file is
 *    configured (today's behavior).
 *
 * Phase 2 removed the Dashboard JWT path: the Notebook is fully
 * self-contained for credentials (the Dashboard production path was
 * hard-cut).
 */
export async function ensureApiKeyForWorkspace(
  workspaceId: string,
): Promise<string> {
  const workspace = await databaseRuntime
    .runPromise(workspaceRepository.findByIdEffect(workspaceId))
    .catch(() => null)

  if (workspace) {
    const key = await getKnowhereKeyByLabel(workspace.knowhereKeyLabel ?? "default")
    if (key) return key.apiKey
  }

  const defaultKey = await getDefaultKnowhereKey()
  if (defaultKey) return defaultKey.apiKey

  const apiKey = knowhereApiKeyOverride.getApiKey()
  if (apiKey) return apiKey

  throw new Error(
    "No Knowhere API key configured. Set KNOWHERE_API_KEY or provide " +
      "config/knowhere-keys.json.",
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
