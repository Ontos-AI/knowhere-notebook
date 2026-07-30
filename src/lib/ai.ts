import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

/**
 * Server-side AI configuration.
 *
 * Two mutually exclusive chat backends, selected by environment:
 *
 * 1. Vercel AI Gateway (default): set `AI_GATEWAY_API_KEY`. The model is passed
 *    to the AI SDK as a plain string (e.g. "google/gemini-3-flash"); the SDK
 *    resolves it through the Gateway and reads the key automatically. Override
 *    the model with `CHAT_MODEL`.
 *
 * 2. Generic OpenAI-compatible API: set `CHAT_BASE_URL` (plus `CHAT_API_KEY`).
 *    The model is built as a LanguageModelV3 against that base URL, so any
 *    OpenAI-compatible endpoint (local LLM, self-hosted gateway, etc.) works
 *    without the Vercel AI Gateway. `CHAT_MODEL` is MANDATORY in this mode.
 */

const DEFAULT_GATEWAY_MODEL = "google/gemini-3-flash"

/** Model id string, used as the Gateway model and as a log label. */
export const CHAT_MODEL = process.env.CHAT_MODEL ?? DEFAULT_GATEWAY_MODEL

/**
 * True when chat is wired up: either the Vercel AI Gateway key is set, or the
 * OpenAI-compatible `CHAT_BASE_URL` is set.
 */
export function isChatConfigured(): boolean {
  return (
    Boolean(process.env.AI_GATEWAY_API_KEY?.trim()) ||
    Boolean(process.env.CHAT_BASE_URL?.trim())
  )
}

/**
 * Resolve the model to pass to AI SDK calls (`generateObject`, `ToolLoopAgent`).
 *
 * - OpenAI-compatible mode (`CHAT_BASE_URL` set): returns a `LanguageModelV3`
 *   built from `CHAT_BASE_URL` + `CHAT_API_KEY`. Requires `CHAT_MODEL`.
 * - Gateway mode (default): returns the plain model id string; the AI SDK
 *   resolves it via the Vercel AI Gateway using `AI_GATEWAY_API_KEY`.
 */
export function getChatModel() {
  const baseURL = process.env.CHAT_BASE_URL?.trim()
  if (baseURL) {
    const modelId = process.env.CHAT_MODEL?.trim()
    if (!modelId) {
      throw new Error(
        "CHAT_MODEL is required when CHAT_BASE_URL is set. Provide the model " +
          "id your OpenAI-compatible endpoint exposes.",
      )
    }
    const apiKey = process.env.CHAT_API_KEY?.trim()
    if (!apiKey) {
      throw new Error("CHAT_API_KEY is required when CHAT_BASE_URL is set.")
    }
    return createOpenAICompatible({
      name: "chat",
      baseURL,
      apiKey,
    }).chatModel(modelId)
  }
  return CHAT_MODEL
}

/** Stable model label for logs, regardless of backend. */
export function getChatModelLabel(): string {
  return CHAT_MODEL
}
