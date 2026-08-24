const DEFAULT_SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const

const BETTER_AUTH_SESSION_COOKIE_NAME =
  /^(?:__Secure-)?better-auth(?:[-.][A-Za-z0-9_]+)*[-.]session_token$/u

export function sessionCookieNames(): readonly string[] {
  return configuredSessionCookieNames() ?? DEFAULT_SESSION_COOKIE_NAMES
}

export function isSessionCookieName(name: string): boolean {
  return (
    sessionCookieNames().includes(name) ||
    BETTER_AUTH_SESSION_COOKIE_NAME.test(name)
  )
}

function configuredSessionCookieNames(): readonly string[] | null {
  const override = process.env.SESSION_COOKIE_NAMES
  if (override === undefined || override.trim().length === 0) return null

  return override
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
}
