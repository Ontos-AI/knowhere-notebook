import { createDeepSeek } from "@ai-sdk/deepseek";

/**
 * Server-side AI provider configuration.
 * Uses DeepSeek via their OpenAI-compatible API.
 */
export function getAIModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY environment variable is required. " +
        "Set it in your .env.local file."
    );
  }

  const deepseek = createDeepSeek({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });

  return deepseek("deepseek-chat");
}
