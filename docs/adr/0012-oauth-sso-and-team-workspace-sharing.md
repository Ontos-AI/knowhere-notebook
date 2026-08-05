# ADR 0012: OAuth/SSO and team workspace sharing

**Date:** 2026-08-05

## Status

Accepted (Phase 4 of the auth/workspace overhaul)

## Context

Phase 2 (ADR 0010) built Notebook-owned identity with password login only.
Operators asked for SSO (Google/GitHub) so users don't need admin-provisioned
passwords, and for team sharing so several users can work in one workspace
(namespace-scoped document set) instead of every user owning their own copy.

## Decision

### OAuth/SSO (P4-1, P4-2)

1. **Env-configured provider registry.** `src/infrastructure/auth/oauth-providers.ts`
   statically defines Google and GitHub providers with their OAuth2 endpoints,
   scopes, and userinfo field keys; a provider is *offered* only when
   `OAUTH_<NAME>_CLIENT_ID` and `OAUTH_<NAME>_CLIENT_SECRET` are both set.
   Adding a provider later = a new entry in the registry + env vars; no
   schema or login-page change.
2. **DIY OAuth2 authorization-code + PKCE.** No third-party OAuth SDK.
   `src/infrastructure/auth/oauth.ts` builds the authorize URL with a random
   `state` and S256 PKCE verifier stored in short-lived HttpOnly cookies,
   then on callback verifies state, exchanges the code server-side, fetches
   userinfo, and finds-or-creates the user + `account_links` row (which was
   already provider-agnostic per ADR 0010). OAuth-created users have no
   password — their `password_hash` is null, and only that provider's link
   identifies them.
3. **Session handoff via existing session machinery.** The callback creates a
   normal DB session row and redirects to `/`; nothing about the cookie or
   `getCurrentUser` changes for OAuth users.
4. **Callback redirect URLs are derived from the request origin**
   (`/api/auth/<provider>/callback`), so the same build works on any host.

### Team sharing via workspace members (P4-3)

5. **New `workspace_members` table** (userId, workspaceId, soft-delete;
   unique `(workspaceId, userId)`). `workspaces.user_id` remains the
   **owner** (implicit); members are invitees. Roles are binary (owner vs
   member) — no per-member permission matrix in this phase.
6. **Membership-aware reads, not per-route checks.** Only two queries changed:
   `findAllByUserIdEffect` (owned ∪ member workspaces — the switcher and SSR
   list shared workspaces automatically) and `findByIdAndUserIdEffect`
   (owner OR member). Every route guard built on `findByIdAndUserIdEffect`
   inherits membership access with no further edits.
7. **Invites are by email, to existing users only** (users are still
   admin-provisioned / OAuth-created). The Members dialog invites by email
   (404 with a friendly message if the user doesn't exist); the owner can
   remove members; the owner cannot be removed.
8. **Re-invite revives the soft-deleted row** (`onConflictDoUpdate` setting
   `deleted_at = NULL`) so removing and re-adding a member is idempotent.
   The unique index is non-partial so Postgres can infer the conflict target.
9. **Credentials stay user-scoped and private.** Members never see the
   owner's API keys; the owner's active key is used for the shared
   namespace (a member's own keys are only used when the member's *own*
   workspace resolves credentials).
10. **Dashboard SSO is a session handoff, not OAuth.** When
    `DASHBOARD_ORIGIN` is set, the login page offers "SSO (Dashboard)".
    The Dashboard's Better Auth session cookie is host-scoped (ports are
    ignored for cookies), so the browser already sends it to the notebook
    on another port; `GET /api/auth/dashboard/start` forwards the full
    cookie jar to the Dashboard's public `users.getCurrentUser` oRPC
    endpoint and logs the user in via find-or-create. Linking is by
    `(dashboard, providerUserId)`; on an email collision the notebook
    adopts an existing user only when that user has no password
    (pristine or OAuth-created) — a password-protected account is refused
    with 409, since silently adopting it would be an account takeover.
    Cross-host deployments work by setting the Dashboard's
    `AUTH_COOKIE_DOMAIN` (Better Auth crossSubDomainCookies) so the same
    session cookie reaches the notebook on a shared parent domain.
11. **Cache Components changes GET-route prerendering.** With
    `cacheComponents: true`, GET route handlers are prerendered at build
    time: the Dashboard start route's early `getDashboardProvider()` 404
    (env absent at build) was baked into a year-long static cache
    (`x-nextjs-cache: HIT`, `s-maxage=31536000`) that ignored runtime
    env. Fix: dynamic APIs (`cookies()`) must be reached before any early
    return so prerendering terminates. `export const dynamic` is not
    allowed under cacheComponents. The Google/GitHub start/callback
    routes escaped this because they read `request.url` first.

## Consequences

- OAuth users appear as normal users; the password form and provider buttons
  coexist on `/login` (providers render only when configured).
- Members can chat and read sources in a shared workspace but cannot invite
  others or remove the owner; there is no leave/transfer-ownership flow yet.
- A member's `active_knowhere_api_key_id` is irrelevant while they operate
  in a shared workspace (owner's key resolves); if the owner deletes their
  key, member access degrades exactly as owner access would.
- GitHub users with private primary emails get a provider-scoped fallback
  email handle when the email endpoint yields nothing.
