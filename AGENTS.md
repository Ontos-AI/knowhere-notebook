<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing or modifying any
Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first. In the final response,
name the guide topics you consulted when Effect code changed.

For browser and server HTTP calls in app code, prefer the established
Effect/@effect/platform pattern (`HttpClientRequest`, `HttpClient`,
`FetchHttpClient`) or an existing local wrapper. Do not introduce direct
component-level `fetch` calls unless there is a specific API limitation, and
document that limitation before coding.

## Local Effect Source

The Effect v4 repository is cloned to `~/.local/share/effect-solutions/effect` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

<!-- effect-solutions:end -->

## Commands

- **Install:** `pnpm install` (uses pnpm 10, Node 22)
- **Dev:** `pnpm dev` (starts Upstash QStash dev server in background + Next.js dev)
- **Lint:** `pnpm lint`
- **Typecheck:** `pnpm typecheck`
- **Unit tests:** `pnpm test` (vitest, node environment)
- **Single test:** `pnpm test -- src/path/to.test.ts`
- **Watch tests:** `pnpm test:watch`
- **E2E tests:** `pnpm test:e2e` (Playwright, chromium only)
- **Integration tests:** `pnpm test:integration` (needs `TEST_DATABASE_URL`; script currently globs `src/lib/*.integration.test.ts` which has no matches — real integration tests are in `src/domains/`)
- **DB schema push:** `pnpm db:push --force` (dev; `--force` skips the TTY prompt because `drizzle.config.ts` sets `strict: true`). drizzle-kit does **not** load `.env.local`, so pass it inline: `DATABASE_URL=… pnpm db:push --force`. `pnpm db:migrate` for prod.
- **Build:** `pnpm build`
- **Docker image:** `docker build -t knowhere-notebook:dev .` then `docker run -d --name knowhere-notebook -p 3001:3000 --add-host localhost.localstack.cloud:host-gateway --env-file .env.docker knowhere-notebook:dev` (standalone, non-root, port 3000). The `--add-host` flag is required for self-hosted Knowhere with LocalStack S3 so the container can resolve `localhost.localstack.cloud` to the host gateway (used for fetching table/image chunk assets server-side). To override the chat prompt templates with your own file, bind-mount it over the built-in one (host file must be world-readable, e.g. `chmod 644`): `-v /host/path/chat-prompt-templates.json:/app/public/data/chat-prompt-templates.json:ro`.
- **Knowhere API keys file:** legacy bootstrap — multiple API keys (one per document domain) live in `config/knowhere-keys.json` — `[{ "label": "domainA", "apiKey": "sk_…" }, …]`. The file is re-read per request (mtime-cached), so edits take effect with **no restart**. Bind-mount it: `-v /host/path/knowhere-keys.json:/app/config/knowhere-keys.json:ro` (host file world-readable). Without the file, `KNOWHERE_API_KEY` env remains the single-key fallback (`label: "default"`). Read via `src/integrations/knowhere-keys.ts` (server-only). Phase 3 prefers DB-backed encrypted keys (see above); the file/env path is only a fallback. Never put the file in `public/`.

CI runs: `lint → typecheck → test → build` on PRs to `main` and `staging`.

## Architecture

```
src/
  app/              Next.js App Router pages and route handlers
  components/       React components — domain features and shadcn/ui primitives
  domains/          Product logic: chat, chunks, sources, workspace
  agent-harness/    Chat agent validation/ledger runtime
  providers/        Client-side context providers
  proxy.ts          Edge middleware (renamed from middleware.ts in Next.js 16)
  infrastructure/   Owned platform: auth, database (Drizzle + Neon Postgres)
  integrations/     External systems: Dashboard oRPC, Knowhere SDK
  lib/              Cross-cutting utilities (effect-operation, route-result, etc.)
```

- Route handlers are thin HTTP adapters: parse request → call a **Route Service** (in `src/domains/*/route-*.ts`) → serialize `RouteResult`. See `src/app/api/chat/route.ts` for the pattern.
- `RouteResult` (`src/lib/route-result.ts`) is the standard return type: `{ status, body }`. Use `routeResult.ok()`, `routeResult.badRequest()`, etc.
- `nextRouteContext` (`src/lib/next-route-context.ts`) extracts the cookie header from the incoming request for Route Services.
- Domain modules own workflow logic; Route Services own the route-to-domain boundary.

## Key Conventions

- **Path alias:** `@/*` → `./src/*`
- **server-only:** Server modules import `server-only`. Vitest aliases it to a no-op stub (`src/test/server-only-stub.ts`).
- **Dashboard oRPC bodies:** Always use `setEmptyJsonBody` from `src/integrations/dashboard/orpc-request.ts`. Effect's `bodyText` defaults to `text/plain`, which causes Dashboard to return the wrong response shape (200 schema mismatch → "no valid session").
- **No raw fetch in app code:** Use Effect's `HttpClient`/`HttpClientRequest` or an existing wrapper.
- **Soft deletes:** Resources use `deletedAt` timestamps; reads filter `deleted_at IS NULL` by default.
- **DB schema:** Only portable Postgres. No Neon-only features, no pgvector. Schema at `src/infrastructure/db/schema.ts`. Drizzle config at `drizzle.config.ts` points to `DATABASE_URL`.
- **Database driver:** `DATABASE_DRIVER=pg` for local dev (postgres-js), `neon` (default) for Vercel/Neon production.
- **Auth:** Notebook owns identity (Phase 2+, ADR 0010): `users` + `account_links` (provider-agnostic, passwordHash lives here) + DB-backed `sessions`. The `notebook-session` cookie (HttpOnly) carries the session id; `getCurrentUser` (`src/infrastructure/auth/index.ts`) joins sessions × users. Users are admin-provisioned via `scripts/create-user.ts` (no public signup); passwords are Argon2id (`src/lib/password.ts`). Login is the local `/login` Server Action; logout is `src/app/auth/logout`. The edge proxy only checks cookie presence (`notebookSessionCookieName` constant — no DB import in the edge bundle); real login is always required (no dev-user bootstrap). The Dashboard is hard-cut: `ensureApiKeyForWorkspace` lives in `src/integrations/knowhere-credentials.ts` and resolves the workspace's active DB key first (decrypted via `src/lib/secret-crypto.ts`), then the file/env fallback.
- **OAuth/SSO (Phase 4, ADR 0012):** env-configured provider registry (`src/infrastructure/auth/oauth-providers.ts`; `OAUTH_GOOGLE_CLIENT_ID/_SECRET`, `OAUTH_GITHUB_CLIENT_ID/_SECRET` — a provider is only offered when its env pair is present). DIY OAuth2 authorization-code + PKCE in `src/infrastructure/auth/oauth.ts`: `GET /api/auth/[provider]/start` returns the authorize URL (JSON, client navigates); `GET /api/auth/[provider]/callback` verifies state + PKCE (short-lived HttpOnly cookies), exchanges the code, fetches userinfo, finds-or-creates the user + `account_links` row, creates a session, redirects to `/`. Callback URL is derived from the request origin. OAuth users have `password_hash = null`.
- **Dashboard SSO (Phase 4):** when `DASHBOARD_ORIGIN` is set, `/login` offers "SSO (Dashboard)". The Dashboard's Better Auth session cookie is host-scoped (not port-scoped), so the browser sends it to the notebook on another port. `GET /api/auth/dashboard/start` forwards the full cookie jar (via `cookies()`) to the Dashboard's public `users.getCurrentUser` oRPC endpoint (`POST {origin}/api/orpc/users.getCurrentUser`, empty JSON body, 3s timeout) and logs in via find-or-create — link by `(dashboard, providerUserId)` first; on email collision only adopts a user with no password, else 409. Works cross-host via the Dashboard's `AUTH_COOKIE_DOMAIN` shared-domain cookies.
- **cacheComponents pitfall:** with `cacheComponents: true` (next.config.ts), Next.js prerenders `GET` route handlers at build time — a route whose early return (e.g. env check) 404s before touching a dynamic API gets that build-time response baked into a permanent static cache (`x-nextjs-cache: HIT`, `s-maxage=31536000`). Any GET handler that depends on runtime env/cookies must call `cookies()` (or another dynamic API) BEFORE its first early return. `export const dynamic` is forbidden under cacheComponents.
- **Team sharing (Phase 4, ADR 0012):** `workspace_members(userId, workspaceId)` — `workspaces.user_id` stays the owner; members get access via rows. Membership is baked into the two repository queries `findAllByUserIdEffect` (owned ∪ member — switcher/SSR list shared workspaces) and `findByIdAndUserIdEffect` (owner OR member), so all route guards inherit it. API: `GET/POST /api/workspaces/:id/members` (invite by email, existing users only), `DELETE /api/workspaces/:id/members/:userId` (owner only). Members dialog lives in the workspace switcher ("Members…"). Re-invite revives the soft-deleted row via `onConflictDoUpdate`; the unique `(workspace_id, user_id)` index is non-partial so Postgres infers the conflict target.
- **Encrypted API keys (Phase 3/UX):** API keys are user-scoped and managed via the combined dropdown's "API keys…" dialog (`src/components/workspace-api-keys-dialog.tsx`) backed by `src/app/api/api-keys` routes. Keys are AES-256-GCM encrypted at rest (`knowhere_api_keys.user_id` FK; `KNOWHERE_KEY_ENCRYPTION_KEY` env — 32-byte base64), never shown after save, and validated against Knowhere on add (422 on invalid). Adding a key auto-creates the `(user, "default")` home workspace with it active.
- **Chat provider:** two backends in `src/lib/ai.ts` — `AI_GATEWAY_API_KEY` (Vercel AI Gateway, model as plain string) OR `CHAT_BASE_URL`+`CHAT_API_KEY`+`CHAT_MODEL` (OpenAI-compatible `LanguageModelV3`). Use `getChatModel()`/`isChatConfigured()`; never reintroduce per-call-site `AI_GATEWAY_API_KEY` guards. `@ai-sdk/openai-compatible` is pinned to 2.x (provider V3) to match `ai@6`.
- **BM25 retrieval:** retrieval queries run with `rerank: true` and `internalRecallK: 30` (`buildRetrievalQueryParams` in `src/domains/chat/index.ts`) to compensate for BM25 keyword ranking. The harness system prompt (`src/agent-harness/runtime.ts`) instructs keyword-crafting, query expansion, and multiple focused `retrieve` calls for multi-part questions. The transient `RetrievalTraceView` (query, namespace, hits, top scores) rides on fresh assistant messages and is rendered by `ChatRetrievalTrace` — it is never persisted to the chat message row, so don't persist or serialize it from the DB.
- **Retrieval overrides:** the chat composer exposes rerank (Switch), Recall K (Slider 5–50), and Top K (Slider 1–12) controls. They travel as optional `retrievalParams` in the chat request body (`src/domains/chat/request.ts` — schema validates + clamps) and override the hardcoded defaults / harness-chosen topK via `RetrievalOverrides` in `answerQuestionWithRetrieval`. Keep current values as UI defaults (`rerank: true`, `internalRecallK: 30`, `topK: 8`).
- **Chat prompt templates:** canned prompts live in `public/data/chat-prompt-templates.json` (`{ id, title, prompt }[]`), fetched client-side by `usePromptTemplates` (cache-busted) and shown in the composer's wand-icon Templates dropdown. Override at runtime by bind-mounting your own JSON over `/app/public/data/chat-prompt-templates.json:ro` — no rebuild needed. `src/domains/chat/prompt-templates.ts` holds only the `ChatPromptTemplate` type now.
- **Folded chat sections:** assistant "Sources" and "Retrieval" blocks are collapsed by default via the shared `CollapsibleSection` (`src/components/collapsible-section.tsx`, Base UI Collapsible). Trigger is the label row with a chevron; badge shows counts.
- **Vercel Blob is optional:** the chunk-page cache (`src/domains/chunks/server.ts`) is gated on `BLOB_READ_WRITE_TOKEN`; without it the cache is skipped and chunks are served straight from Knowhere. Don't add hard `@vercel/blob` calls in request paths without gating on the token or wrapping in a read-failure-as-miss handler.
- **Table chunk enrichment:** the Knowhere `listChunks` endpoint returns `assetUrl` for table/image chunks but the HTML is at that URL, not in `chunk.content` (which holds a summary). `enrichChunksWithAssetUrls` in `src/domains/chunks/server.ts` fetches the HTML from `assetUrl` server-side after the list call and sets it as `chunk.content` so `TableChunkCard`'s `getSanitizedTableHtml` can detect and render it. This avoids browser CORS issues with LocalStack S3 URLs. Requires `--add-host localhost.localstack.cloud:host-gateway` in Docker.
- **Fonts:** use the local `geist` package (`GeistSans`/`GeistMono` from `geist/font/*`), not `next/font/google` — the repo runs in airgapped/self-hosted setups where Google Fonts is unreachable.
- **Desktop layout:** 2-panel (sources | chat) with one resize handle. Chunks are a full-screen overlay (`fixed inset-0 z-50`), not an inline panel. `PanelId` is `"sources" | "chat"`. The chunks overlay opens via the source-row tree button or by clicking a citation in chat. A namespace dropdown in the sources panel header lets users import documents from any Knowhere namespace.
- **No demo or guest mode:** Demo catalog, guest mode, and the Official Library panel have been removed. All sources are either `kind: "workspace"` (local DB row) or `kind: "remote"` (Knowhere document not yet localized). Anonymous requests redirect to login.
- **Eager localization:** Compatible-namespace Knowhere documents are auto-localized into workspace Source rows on every source list load (`GET /api/sources` and SSR). No user click needed. `localizeRemoteLibrarySources` pre-filters against existing DB rows to avoid redundant writes.
- **SourceKind:** `"workspace" | "remote"` only. The `"demo"` variant has been removed.
- **Namespace API:** `GET /api/namespaces` lists all Knowhere namespaces with document counts. `POST /api/namespaces/[namespace]/localize` bulk-localizes all documents from a specific namespace. The SDK does not expose a namespaces endpoint, so `listKnowhereNamespaces` in `src/integrations/knowhere.ts` calls `GET /v1/documents/namespaces` directly.
- **Workspaces (UX model):** a workspace binds one user to one Knowhere namespace — `(user, namespace)` unique. Workspaces are key-agnostic: `workspaces.active_knowhere_api_key_id` (nullable) is the mutable credential pointer; `ensureApiKeyForWorkspace` resolves active key → first user key → file/env fallback. New users have **no workspace** until they add an API key (which auto-creates `(user, "default")`) or pick a namespace from the combined `WorkspaceSwitcher` dropdown (which creates `(user, namespace)` + eagerly localizes its documents, blocking with a spinner). The active workspace is tracked by the `notebook-ws` cookie; `ensureWorkspace` returns null when the user has none — route callers must 400 "No workspace yet". `getCompatibleNamespaces` is `[workspace.namespace]` only; uploads/retries target the workspace's own namespace. No legacy `notebook-<uuid>` auto-creation.

## Domain Language

See `CONTEXT.md` for precise definitions of Workspace, Source, Parsed Chunk, Chat Thread, Citation, Route Service, Route Context, and other domain terms. Use those names in modules, tests, and route workflows.

## UI & Design

- Reuse design units from the dashboard (github.com/ontosAI/knowhere-dashboard). Match spacing, typography, and color usage.
- shadcn/ui (base-nova style, Tailwind CSS 4). Add components via the shadcn skill or `pnpm dlx shadcn@latest add <component>`.
- Installed shadcn primitives: alert-dialog, badge, button, card, checkbox, dialog, dropdown-menu, empty, input, scroll-area, separator, sheet, skeleton, spinner, tabs, textarea, tooltip.
- Lucide icons. Semantic Tailwind colors (`bg-primary`, `text-muted-foreground`), never raw color values.

## Testing Quirks

- Unit tests run in **node** environment (not jsdom) by default. Test files: `src/**/*.test.ts`.
- `server-only` is stubbed out in tests — don't expect it to throw.
- Integration tests (in `src/domains/`) use `describe.skip` when `TEST_DATABASE_URL` is unset, so `pnpm test` includes them as safe skips. To run them for real, set `TEST_DATABASE_URL` to a running Postgres.
- E2E tests (Playwright) are in `e2e/`, match `**/*.e2e.ts`. They start `pnpm dev` automatically unless `PLAYWRIGHT_EXTERNAL_WEB_SERVER=1`.
