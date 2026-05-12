# Knowhere Notebook

Upload documents, explore parsed content, and ask questions about your knowledge — powered by the Knowhere API.

## Getting Started

1. Copy the environment template:
   ```bash
   cp .env.local.example .env.local
   ```

2. Fill in your API keys in `.env.local`:
   - `AI_GATEWAY_API_KEY` — your Vercel AI Gateway key for chat (optional `CHAT_MODEL` override)

3. Install dependencies and run:
   ```bash
   pnpm install
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org) with App Router and Server Components
- **AI**: [Vercel AI SDK](https://sdk.vercel.ai) + [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- **Knowledge**: [Knowhere Node.js SDK](https://github.com/Ontos-AI/knowhere-sdk) for document parsing and retrieval
- **UI**: [shadcn/ui](https://ui.shadcn.com) + Tailwind CSS 4
- **Icons**: [Lucide](https://lucide.dev)

## CI and Releases

The CI workflow runs lint, typecheck, tests, and build on pull requests targeting
`main` and `staging`.

After changes are merged to `main`, the release workflow creates a date-based
GitHub Release with a source archive and build metadata.

## Dashboard Auth Integration

Notebook treats Dashboard as the auth source of truth. Server-side auth calls
forward the incoming session cookie to Dashboard oRPC endpoints, including
`/api/orpc/users/getCurrentUser` and `/api/orpc/users/issueServiceJwt`.

Dashboard chooses its oRPC handler by request shape and `Content-Type`.
When using Effect's `HttpClientRequest.bodyText`, pass
`"application/json"` as the body content type. Setting the header before
`bodyText("{}")` is not enough because `bodyText` overwrites it with
`text/plain`. If that happens, Dashboard can return a successful OpenAPI-shaped
response instead of the RPC envelope, and Notebook will log a 200
`schema mismatch` followed by `no valid session`.

Use `setEmptyJsonBody` from `src/integrations/dashboard/orpc-request.ts` for empty
Dashboard oRPC POST bodies.

## Project Structure

```
src/
├── app/              # Next.js App Router pages and route handlers
├── components/       # React components and shadcn/ui primitives
├── domains/          # Product domains: chat, chunks, sources, workspace
├── infrastructure/   # Owned platform concerns: auth and database access
├── integrations/     # External systems: Dashboard and Knowhere
└── lib/              # Small cross-cutting utilities
```
