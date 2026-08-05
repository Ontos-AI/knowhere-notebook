type KnowhereDevelopmentUser = {
  readonly id: string
  readonly email: string | null
  readonly name: string | null
}

const developmentUser: KnowhereDevelopmentUser = {
  id: "knowhere-api-key-dev-user",
  email: null,
  name: "Knowhere API Key Development",
}

/**
 * Edge-safe dev-mode presence check. The server-side multi-key reader
 * (src/integrations/knowhere-keys.ts) may load keys from a file the edge
 * proxy cannot read, so the presence of KNOWHERE_KEYS_FILE is honored here
 * too — the proxy short-circuit must not redirect when file-backed keys
 * exist.
 */
function hasDevModeKeys(): boolean {
  if (process.env.KNOWHERE_KEYS_FILE?.trim()) return true
  const value = process.env.KNOWHERE_API_KEY?.trim()
  return Boolean(value && value.length > 0)
}

function getApiKey(): string | null {
  const value = process.env.KNOWHERE_API_KEY?.trim()
  return value && value.length > 0 ? value : null
}

function hasApiKey(): boolean {
  return hasDevModeKeys()
}

function getDevelopmentUser(): KnowhereDevelopmentUser | null {
  if (!hasDevModeKeys()) return null
  return developmentUser
}

export const knowhereApiKeyOverride = {
  getApiKey,
  hasApiKey,
  getDevelopmentUser,
} as const
