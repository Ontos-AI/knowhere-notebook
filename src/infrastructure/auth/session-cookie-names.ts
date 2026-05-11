const DEFAULT_SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const

export function sessionCookieNames(): readonly string[] {
  const override = process.env.SESSION_COOKIE_NAMES
  if (override !== undefined && override.trim().length > 0) {
    return override
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return DEFAULT_SESSION_COOKIE_NAMES
}
