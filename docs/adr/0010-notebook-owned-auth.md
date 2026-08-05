# ADR 0010: Notebook-owned authentication

**Date:** 2026-08-05

## Status

Accepted (Phase 2 of the auth overhaul)

## Context

The Notebook previously delegated all identity to the Knowhere Dashboard:
a Better Auth session cookie on the shared parent domain was forwarded to
Dashboard's `users.getCurrentUser` oRPC endpoint for identity, and
`users.issueServiceJwt` minted short-lived Knowhere JWTs per request.
Self-hosted deployments ran in "dev mode" with a single hardcoded
development user enabled by `KNOWHERE_API_KEY`.

The operator wants a self-hosted Notebook that does not depend on the
Dashboard at all: its own users, its own sessions, and modular login
providers (password now, OAuth/SSO later). The Dashboard production path
is being retired (hard-cut), and self-hosted dev mode evolves into a
first-class Notebook-owned auth system.

## Decision

1. **Own the identity store.** New `users`, `account_links`, and `sessions`
   tables in Notebook's Postgres. `account_links` is provider-agnostic
   (one row per user+provider; `password_hash` lives there, not on
   `users`), so OAuth providers can be added without schema changes.
2. **DB-backed sessions.** The `notebook-session` cookie (HttpOnly,
   SameSite=Lax, Secure in prod, 30-day TTL) holds the session id; every
   `getCurrentUser` joins `sessions × users`. Sessions are revocable
   server-side (logout deletes the row).
3. **Password hashing with Argon2id** (`@node-rs/argon2`), interactive cost
   tuned for login.
4. **Admin-provisioned users only.** No public signup in this phase —
   `scripts/create-user.ts` creates users (email, password, optional name).
   Password verification happens in the login Server Action.
5. **Local login page.** `src/app/login` renders an email+password form
   (Server Action), replacing the Dashboard redirect link.
6. **Edge proxy checks the Notebook session cookie** (edge-safe constant,
   no DB import in the edge bundle); anonymous redirects go to the local
   `/login`.
7. **Dashboard hard-cut.** Delete `src/integrations/dashboard/`
   (`api-key-service.ts`, `orpc-request.ts`), `auth/urls.ts`,
   `auth/session-cookie-names.ts`. `ensureApiKeyForWorkspace` moves to
   `src/integrations/knowhere-credentials.ts` and resolves credentials
   solely from the workspace's key label / keys file / env — no JWT
   issuance. The "Open Dashboard" top-nav link, its prop plumbing, and the
   `notebook_dashboard_link_clicked` analytics event are removed.
8. **Dev-mode bootstrap kept.** `KNOWHERE_API_KEY` (or `KNOWHERE_KEYS_FILE`)
   still short-circuits to the development user so a fresh deployment
   works before any user is created. Removed in Phase 3 when DB-backed
   keys land.

## Consequences

- Self-hosted Notebook is fully self-contained: users, sessions, and
  Knowhere credentials live in Notebook-owned storage.
- Cloud deployments that used the Dashboard path must either adopt
  Notebook auth or stay on a pre-Phase-2 release.
- Email verification, password reset, and OAuth/SSO providers are deferred
  (Phase 4) but the `account_links` shape anticipates them.
- `workspaces.userId` continues to hold the Notebook user id (was the
  Dashboard user id string; the semantics now point at `users.id`).
