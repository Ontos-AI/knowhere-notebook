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

function getApiKey(): string | null {
  const value = process.env.KNOWHERE_API_KEY?.trim()
  return value && value.length > 0 ? value : null
}

function hasApiKey(): boolean {
  return getApiKey() !== null
}

function getDevelopmentUser(): KnowhereDevelopmentUser | null {
  if (!hasApiKey()) return null
  return developmentUser
}

export const knowhereApiKeyOverride = {
  getApiKey,
  hasApiKey,
  getDevelopmentUser,
} as const
