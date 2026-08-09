# Knowhere Notebook

Upload documents, explore parsed content, and ask questions about your knowledge — powered by the Knowhere API.

## Getting Started

1. Copy the environment template:
   ```bash
   cp .env.local.example .env.local
   ```

2. Fill in your API keys in `.env.local`:
   - Chat (one of):
     - `AI_GATEWAY_API_KEY` — Vercel AI Gateway key (optional `CHAT_MODEL` override, default `google/gemini-3-flash`), or
     - `CHAT_BASE_URL` + `CHAT_API_KEY` + `CHAT_MODEL` — any OpenAI-compatible endpoint (e.g. DeepSeek, local Xinference/vLLM). `CHAT_MODEL` is required in this mode.
    - `KNOWHERE_API_KEY` — optional dev bootstrap key that enables the deterministic local user (see Authentication below)
   - `NEXT_PUBLIC_POSTHOG_KEY` — PostHog Project API key for front-end event tracking
   - `NEXT_PUBLIC_POSTHOG_HOST` — PostHog ingestion host (default `https://us.i.posthog.com`)

3. Install dependencies and run:
   ```bash
   pnpm install
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## PostHog Tracking

Notebook sends these product analytics events when PostHog is configured:

- `notebook_upload_button_clicked`
- `notebook_document_upload_completed` (`uploaded_count`, `file_types`, `total_size_bytes`)
- `notebook_assistant_question_submitted` (`selected_sources_count`, `message_length`)
- `notebook_dashboard_link_clicked`

Notebook also calls PostHog `identify` for authenticated users and `reset` for
guest sessions so insights can be grouped by user.

### Connect Notebook to PostHog

1. In PostHog, create/select a project.
2. Copy the project API key and ingestion host.
3. Set these values in `.env.local`:
   ```bash
   NEXT_PUBLIC_POSTHOG_KEY=phc_your_project_api_key
   NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
   ```
4. Restart `pnpm dev` (or `npm run dev`), then trigger a few actions in Notebook.
5. Open PostHog `Events` and filter by the event names above to verify ingestion.

### Where to view the metrics

Create four Trends insights in PostHog:

1. Upload button clicks: count of `notebook_upload_button_clicked`
2. Uploaded documents: `sum(uploaded_count)` on `notebook_document_upload_completed`
3. Avg sources per question: `avg(selected_sources_count)` on `notebook_assistant_question_submitted`
4. Users opening dashboard: `Unique users` on `notebook_dashboard_link_clicked`

Pin those four insights to a `Notebook Tracking` dashboard for team reporting.

GA4 field and event alignment guidance lives in `docs/ga4-alignment.md`.

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org) with App Router and Server Components
- **AI**: [Vercel AI SDK](https://sdk.vercel.ai) via the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) or any OpenAI-compatible endpoint (see `docs/adr/0007-chat-provider-abstraction.md`)
- **Knowledge**: [Knowhere Node.js SDK](https://github.com/Ontos-AI/knowhere-sdk) for document parsing and retrieval
- **UI**: [shadcn/ui](https://ui.shadcn.com) + Tailwind CSS 4
- **Icons**: [Lucide](https://lucide.dev)

## CI and Releases

The CI workflow runs lint, typecheck, tests, and build on pull requests targeting
`main` and `staging`.

After changes are merged to `main`, the release workflow creates a date-based
GitHub Release with a source archive and build metadata.

## Deployment (Docker)

Notebook ships as a standalone Next.js image built with `output: "standalone"`.

```bash
docker build -t knowhere-notebook:dev .
docker run -d --name knowhere-notebook -p 3000:3000 \
  --env-file .env.docker knowhere-notebook:dev
```

The image runs the traced standalone server as a non-root user on port 3000.
Provide the same variables as `.env.local` (via a gitignored `.env.docker`):
`KNOWHERE_API_KEY`/`KNOWHERE_BASE_URL`, `DATABASE_URL`/`DATABASE_DRIVER`, and
chat config (`AI_GATEWAY_API_KEY` or `CHAT_BASE_URL`+`CHAT_API_KEY`+`CHAT_MODEL`).

When running against a Knowhere stack on the host (Docker Desktop / OrbStack),
use `host.docker.internal` in `KNOWHERE_BASE_URL` and `DATABASE_URL` so the
container can reach the host services.

**Vercel Blob is optional.** The chunk-page cache is backed by Vercel Blob when
`BLOB_READ_WRITE_TOKEN` is set; without it, the cache is disabled and chunks
are served straight from Knowhere. This is what lets self-hosted / local
deployments work without a Blob store.

## Authentication

Notebook owns its authentication (ADR 0010): users, provider account links,
and DB-backed sessions live in Notebook's Postgres. The `notebook-session`
cookie carries the session id.

- **Create a user** (admin-provisioned, no public signup):
  ```bash
  pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/create-user.ts \
    you@example.com "a-strong-password" --name "You"
  ```
- **Login** at `/login` (email + password, Argon2id hashing). **Logout** is
  the top-nav sign-out button.
- **Dev bootstrap:** setting `KNOWHERE_API_KEY` (or providing
  `config/knowhere-keys.json`) still short-circuits to a deterministic
  local development user so a fresh deployment works before any user is
  created. This bootstrap is removed once DB-backed keys land.
- Multi-domain API keys: see `config/knowhere-keys.json` and the
  Workspace switcher in the sources panel.

## Project Structure

```
src/
├── app/              # Next.js App Router pages and route handlers
├── components/       # React components and shadcn/ui primitives
├── domains/          # Product domains: chat, chunks, sources, workspace
├── infrastructure/   # Owned platform concerns: auth and database access
├── integrations/     # External systems: Knowhere
└── lib/              # Small cross-cutting utilities
```

## Desktop Layout

Two-panel (sources | chat) with a resize handle. Parsed chunks and the
Official Library are full-screen overlays, triggered by the tree icon on a
source row or a citation reference in chat.

