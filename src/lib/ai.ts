/**
 * Server-side AI configuration — routes through the Vercel AI Gateway.
 *
 * The Gateway gives us one key, usage monitoring, and easy provider/model
 * swaps without code changes. The AI SDK picks up `AI_GATEWAY_API_KEY`
 * automatically when a model is passed as a plain string like
 * `"deepseek/deepseek-v4-flash"`, so this module just owns the model choice.
 *
 * Change CHAT_MODEL here (or via env) when we want to try a different model.
 */

export const CHAT_MODEL = process.env.CHAT_MODEL ?? "deepseek/deepseek-v4-flash"
