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
 * Create a Knowhere client with the given API key.
 * Use for per-request clients created from Dashboard-issued JWTs.
 */
export function makeKnowhereClient(apiKey: string): Knowhere {
  return new Knowhere({ apiKey, baseURL: process.env.KNOWHERE_BASE_URL })
}
