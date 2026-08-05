import "server-only"

/**
 * OAuth2 provider registry. Each provider is configured entirely via env:
 *
 *   OAUTH_GOOGLE_CLIENT_ID=…     OAUTH_GOOGLE_CLIENT_SECRET=…
 *   OAUTH_GITHUB_CLIENT_ID=…     OAUTH_GITHUB_CLIENT_SECRET=…
 *   OAUTH_<UPPER_NAME>_CLIENT_ID / _CLIENT_SECRET for generic providers
 *
 * A provider without its env pair is simply not offered. Custom scopes and
 * discovery URLs are optional env overrides per provider.
 */

export type OAuthProviderName = "google" | "github" | string

export type OAuthProviderConfig = {
  readonly name: string
  readonly displayName: string
  readonly clientId: string
  readonly clientSecret: string
  readonly authorizeUrl: string
  readonly tokenUrl: string
  readonly userInfoUrl: string
  readonly scope: string
  readonly emailKey: string
  readonly idKey: string
  readonly nameKey: string
}

const PROVIDERS: readonly {
  readonly name: string
  readonly displayName: string
  readonly envKey: string
  readonly authorizeUrl: string
  readonly tokenUrl: string
  readonly userInfoUrl: string
  readonly scope: string
  readonly emailKey: string
  readonly idKey: string
  readonly nameKey: string
}[] = [
  {
    name: "google",
    displayName: "Google",
    envKey: "GOOGLE",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    emailKey: "email",
    idKey: "sub",
    nameKey: "name",
  },
  {
    name: "github",
    displayName: "GitHub",
    envKey: "GITHUB",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scope: "read:user user:email",
    emailKey: "email",
    idKey: "id",
    nameKey: "name",
  },
]

export function listOAuthProviders(): readonly OAuthProviderConfig[] {
  return PROVIDERS.flatMap((provider) => {
    const clientId = process.env[`OAUTH_${provider.envKey}_CLIENT_ID`]?.trim()
    const clientSecret = process.env[
      `OAUTH_${provider.envKey}_CLIENT_SECRET`
    ]?.trim()
    if (!clientId || !clientSecret) return []
    return [
      {
        name: provider.name,
        displayName: provider.displayName,
        clientId,
        clientSecret,
        authorizeUrl: provider.authorizeUrl,
        tokenUrl: provider.tokenUrl,
        userInfoUrl: provider.userInfoUrl,
        scope: provider.scope,
        emailKey: provider.emailKey,
        idKey: provider.idKey,
        nameKey: provider.nameKey,
      },
    ]
  })
}

export function getOAuthProvider(name: string): OAuthProviderConfig | null {
  const configured = listOAuthProviders()
  return configured.find((provider) => provider.name === name) ?? null
}
