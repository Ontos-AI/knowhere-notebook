import "server-only"

/**
 * Login provider registry. Each provider is configured entirely via env:
 *
 * OAuth2 (redirect-based):
 *   OAUTH_GOOGLE_CLIENT_ID=…     OAUTH_GOOGLE_CLIENT_SECRET=…
 *   OAUTH_GITHUB_CLIENT_ID=…     OAUTH_GITHUB_CLIENT_SECRET=…
 *
 * Dashboard session handoff (same host, any port):
 *   DASHBOARD_ORIGIN=http://localhost:3000
 *
 * A provider without its env pair is simply not offered.
 */

export type OAuthProviderName = "google" | "github" | string

export type OAuthProviderConfig = {
  readonly kind: "oauth"
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

/**
 * Dashboard SSO: no redirect flow — the user is already logged into the
 * Knowhere Dashboard on the same host (another port, or a shared parent
 * domain via the Dashboard's AUTH_COOKIE_DOMAIN). The notebook forwards the
 * incoming browser Cookie header to Dashboard's public `users.getCurrentUser`
 * oRPC endpoint, which resolves the Better Auth session.
 */
export type DashboardProviderConfig = {
  readonly kind: "dashboard"
  readonly name: "dashboard"
  readonly displayName: "Dashboard"
  readonly dashboardOrigin: string
}

export type LoginProviderConfig = OAuthProviderConfig | DashboardProviderConfig

/** Login-page view: just what the client needs to render the button. */
export type LoginProviderView = {
  readonly name: string
  readonly displayName: string
}

const OAUTH_PROVIDERS: readonly {
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
  return OAUTH_PROVIDERS.flatMap((provider) => {
    const clientId = process.env[`OAUTH_${provider.envKey}_CLIENT_ID`]?.trim()
    const clientSecret = process.env[
      `OAUTH_${provider.envKey}_CLIENT_SECRET`
    ]?.trim()
    if (!clientId || !clientSecret) return []
    return [
      {
        kind: "oauth" as const,
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

export function getDashboardProvider(): DashboardProviderConfig | null {
  const dashboardOrigin = process.env.DASHBOARD_ORIGIN?.trim()
  if (!dashboardOrigin) return null
  return {
    kind: "dashboard",
    name: "dashboard",
    displayName: "Dashboard",
    dashboardOrigin,
  }
}

/** Every provider that should be offered on the login page, in order. */
export function listLoginProviders(): readonly LoginProviderView[] {
  const oauth = listOAuthProviders().map((provider) => ({
    name: provider.name,
    displayName: provider.displayName,
  }))
  const dashboard = getDashboardProvider()
    ? [{ name: "dashboard", displayName: "Dashboard" }]
    : []
  return [...dashboard, ...oauth]
}
