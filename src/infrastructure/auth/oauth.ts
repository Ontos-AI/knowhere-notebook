import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { cookies } from "next/headers"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { usersRepository } from "@/infrastructure/auth/users-repository"
import { accountLinksRepository } from "@/infrastructure/auth/account-links-repository"
import { createSession } from "@/infrastructure/auth/session"
import type { OAuthProviderConfig } from "@/infrastructure/auth/oauth-providers"

/** Cookie names for the OAuth state + PKCE verifier (transient, 10 min). */
const oauthStateCookieName = "oauth-state"
const oauthVerifierCookieName = "oauth-verifier"

const oauthStateTtlSeconds = 10 * 60

type OAuthUserInfo = {
  readonly providerUserId: string
  readonly email: string | null
  readonly name: string | null
}

/** Build the provider authorize URL with state + PKCE. */
export async function buildOAuthAuthorizeUrl(
  provider: OAuthProviderConfig,
  callbackUrl: string,
): Promise<{ readonly url: string; readonly state: string }> {
  const state = randomBytes(24).toString("base64url")
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url")

  const jar = await cookies()
  jar.set(oauthStateCookieName, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: oauthStateTtlSeconds,
  })
  jar.set(oauthVerifierCookieName, verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: oauthStateTtlSeconds,
  })

  const url = new URL(provider.authorizeUrl)
  url.searchParams.set("client_id", provider.clientId)
  url.searchParams.set("redirect_uri", callbackUrl)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", provider.scope)
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")
  return { url: url.toString(), state }
}

/**
 * Complete the OAuth code exchange and log the user in.
 * - verifies state + PKCE verifier cookies
 * - exchanges the code for a token
 * - fetches userinfo
 * - finds-or-creates the user + account_link, creates a session
 * Returns the app path to redirect to, or throws on failure.
 */
export async function completeOAuthLogin(
  provider: OAuthProviderConfig,
  callbackUrl: string,
  code: string,
  state: string,
): Promise<string> {
  const jar = await cookies()
  const expectedState = jar.get(oauthStateCookieName)?.value
  const verifier = jar.get(oauthVerifierCookieName)?.value
  jar.delete(oauthStateCookieName)
  jar.delete(oauthVerifierCookieName)

  if (!expectedState || !verifier || expectedState !== state || !code) {
    throw new Error("OAuth state mismatch or expired.")
  }

  const accessToken = await exchangeCodeForToken(
    provider,
    callbackUrl,
    code,
    verifier,
  )
  const userInfo = await fetchUserInfo(provider, accessToken)
  const user = await findOrCreateUser(provider, userInfo)

  await createSession(user.id)
  return "/"
}

async function exchangeCodeForToken(
  provider: OAuthProviderConfig,
  callbackUrl: string,
  code: string,
  verifier: string,
): Promise<string> {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: callbackUrl,
  })

  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  })
  if (!response.ok) {
    throw new Error(
      `OAuth token exchange failed (${response.status}) for ${provider.name}.`,
    )
  }
  const body = (await response.json()) as Record<string, unknown>
  const token = body.access_token
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`OAuth token exchange returned no access_token for ${provider.name}.`)
  }
  return token
}

async function fetchUserInfo(
  provider: OAuthProviderConfig,
  accessToken: string,
): Promise<OAuthUserInfo> {
  const response = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(
      `OAuth userinfo failed (${response.status}) for ${provider.name}.`,
    )
  }
  const body = (await response.json()) as Record<string, unknown>

  const providerUserId = getString(body[provider.idKey])
  if (!providerUserId) {
    throw new Error(`OAuth userinfo missing ${provider.idKey} for ${provider.name}.`)
  }

  // GitHub may require an extra email endpoint when the primary email is
  // private.
  let email = getString(body[provider.emailKey])
  if (!email && provider.name === "github") {
    email = await fetchGitHubEmail(accessToken)
  }

  return {
    providerUserId,
    email,
    name: getString(body[provider.nameKey]),
  }
}

async function fetchGitHubEmail(accessToken: string): Promise<string | null> {
  const response = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) return null
  const body = (await response.json()) as unknown
  if (!Array.isArray(body)) return null
  const primary = body.find(
    (entry: unknown): entry is { email?: unknown; primary?: unknown } =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { primary?: unknown }).primary === true,
  )
  const email = primary ? getString(primary.email) : null
  return email ?? getString((body[0] as { email?: unknown } | undefined)?.email)
}

async function findOrCreateUser(
  provider: OAuthProviderConfig,
  userInfo: OAuthUserInfo,
) {
  const link = await databaseRuntime.runPromise(
    accountLinksRepository.findByProviderAndProviderUserIdEffect(
      provider.name,
      userInfo.providerUserId,
    ),
  )
  if (link) {
    const existing = await databaseRuntime.runPromise(
      usersRepository.findByIdEffect(link.userId),
    )
    if (existing) return existing
  }

  // First-time OAuth login: create the user (email may be null for GitHub
  // private emails that fail; still allow login with a generated handle).
  const email = userInfo.email ?? `${userInfo.providerUserId}@${provider.name}.oauth`
  const created = await databaseRuntime.runPromise(
    usersRepository.insertEffect({
      email,
      name: userInfo.name ?? null,
    }),
  )
  await databaseRuntime.runPromise(
    accountLinksRepository.insertEffect({
      userId: created.id,
      provider: provider.name,
      providerUserId: userInfo.providerUserId,
      passwordHash: null,
    }),
  )
  return created
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}
