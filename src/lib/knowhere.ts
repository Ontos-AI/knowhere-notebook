import { Context, Layer } from "effect"
import Knowhere from "@ontos-ai/knowhere-sdk"

/**
 * Server-side Knowhere client Effect service.
 * API key is read from the KNOWHERE_API_KEY environment variable.
 */
export class KnowhereClient extends Context.Tag("@knowhere/KnowhereClient")<
  KnowhereClient,
  Knowhere
>() {}

/** Production layer that creates a Knowhere SDK instance from env vars. */
export const knowhereClientLayer = Layer.sync(KnowhereClient, () => {
  const apiKey = process.env.KNOWHERE_API_KEY
  if (!apiKey) {
    throw new Error(
      "KNOWHERE_API_KEY environment variable is required. " +
        "Set it in your .env.local file.",
    )
  }
  return new Knowhere({
    apiKey,
    baseURL: process.env.KNOWHERE_BASE_URL,
  })
})

/**
 * Create a Knowhere client. When `apiKey` is provided it is used directly;
 * otherwise falls back to the `KNOWHERE_API_KEY` environment variable.
 *
 * Prefer passing a per-user API key from `ensureApiKeyForWorkspace` in
 * request-handling code. The env-var fallback exists for local dev and
 * for tests that don't exercise the full auth flow.
 */
export function getKnowhereClient(apiKey?: string): Knowhere {
  const key = apiKey ?? process.env.KNOWHERE_API_KEY
  const baseURL = process.env.KNOWHERE_BASE_URL
  if (!key) {
    throw new Error(
      "KNOWHERE_API_KEY environment variable or per-user API key is required. " +
        "Set it in your .env.local file.",
    )
  }
  return new Knowhere({ apiKey: key, baseURL })
}
