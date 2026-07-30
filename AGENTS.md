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
- **Docker image:** `docker build -t knowhere-notebook:dev .` then `docker run -d --name knowhere-notebook -p 3000:3000 --env-file .env.docker knowhere-notebook:dev` (standalone, non-root, port 3000).

CI runs: `lint → typecheck → test → build` on PRs to `main` and `staging`.

## Architecture

```
src/
  app/              Next.js App Router pages and route handlers
  components/       React components — domain features and shadcn/ui primitives
  domains/          Product logic: chat, chunks, demo, sources, workspace
  infrastructure/   Owned platform: auth, database (Drizzle + Neon Postgres)
  integrations/     External systems: Dashboard oRPC, Knowhere SDK
  lib/              Cross-cutting utilities (effect-operation, route-result, etc.)
  agent-harness/    Chat agent validation/ledger runtime
  providers/        Client-side context providers
  proxy.ts          Edge middleware (renamed from middleware.ts in Next.js 16)
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
- **Auth:** Dashboard is the source of truth. Notebook forwards the session cookie; it never decodes tokens. `KNOWHERE_API_KEY` env enables API-key dev mode (skips Dashboard auth, uses a deterministic local user).
- **Chat provider:** two backends in `src/lib/ai.ts` — `AI_GATEWAY_API_KEY` (Vercel AI Gateway, model as plain string) OR `CHAT_BASE_URL`+`CHAT_API_KEY`+`CHAT_MODEL` (OpenAI-compatible `LanguageModelV3`). Use `getChatModel()`/`isChatConfigured()`; never reintroduce per-call-site `AI_GATEWAY_API_KEY` guards. `@ai-sdk/openai-compatible` is pinned to 2.x (provider V3) to match `ai@6`.
- **Vercel Blob is optional:** the chunk-page cache (`src/domains/chunks/server.ts`) is gated on `BLOB_READ_WRITE_TOKEN`; without it the cache is skipped and chunks are served straight from Knowhere. Don't add hard `@vercel/blob` calls in request paths without gating on the token or wrapping in a read-failure-as-miss handler.
- **Fonts:** use the local `geist` package (`GeistSans`/`GeistMono` from `geist/font/*`), not `next/font/google` — the repo runs in airgapped/self-hosted setups where Google Fonts is unreachable.

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
