import Knowhere from "@ontos-ai/knowhere-sdk";

/**
 * Server-side Knowhere client singleton.
 * API key is read from the KNOWHERE_API_KEY environment variable.
 */
export function getKnowhereClient(): Knowhere {
  const apiKey = process.env.KNOWHERE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "KNOWHERE_API_KEY environment variable is required. " +
        "Set it in your .env.local file."
    );
  }

  return new Knowhere({ apiKey });
}
