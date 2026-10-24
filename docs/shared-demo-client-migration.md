# Shared demo client behavior

Notebook uses the published shared demo corpus directly. The Knowhere
`/api/v1/demo/materializations` endpoint returns 410 and must never be called.

## Selection and retrieval

The current catalog defines source IDs, canonical document IDs, and complete
revision IDs. Missing revision provenance is a boundary error. Catalog reads
are not cached across requests.

`POST /api/demo-sources/select` accepts `{ "demoSourceIds": ["..."] }` and
returns `{ "sources": [...] }`. It restores local visibility idempotently and
does not create private documents. Unselected Official Library entries remain
outside the chat scope. Hiding a demo changes local visibility only.

The Notebook `/api/demo-sources/materialize` route is a temporary compatibility
adapter: it returns shared metadata for still-visible selections without
restoring hidden sources, copying documents, or rewriting saved citations.

Shared retrieval uses `__knowhere_demo__` with an explicit selected document
allowlist. Private retrieval retains its existing scope rules and excludes
legacy demo copies. Folder queries exclude shared demos. Empty selections do
not become unrestricted retrieval requests.

When one requested scope fails and another yields evidence, the response
contains `retrievalWarnings` and the answer displays a coverage notice. The
notice is retained in the existing agent-trace JSON. If no scope supplies
usable evidence, the request fails rather than presenting a partial answer
as complete.

## Reading citations

Source and citation metadata carry `namespace` and `jobResultId`. Retrieval
responses determine citation revision identity; later catalog reads cannot
replace it. Cached chunks, pagination, media copies, and connected-asset
lookups keep revisions separate.

Chat responses expose `citationSources` independently of selectable sources.
Historical private demo copies and hidden shared sources can therefore be
opened from saved citations without rejoining the current query scope. Missing
or unidentifiable historical evidence displays an unavailable state instead of
opening an unrelated current document.

Original-file and asset URLs use stable Notebook routes with `job_result_id`.
The proxy forwards Range requests and meaningful upstream statuses, follows
the upstream signed redirect at request time, and does not cache signed URLs.

## Deployment verification

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Run browser
regressions with `pnpm test:e2e`; `PLAYWRIGHT_CHANNEL=chrome` can select an
already-installed Chrome for local verification. The PDF preview regression
uses a deterministic local PDF, not a live corpus dependency.

After Vercel deploys `main`, verify shared-only and mixed chat, deselection,
hiding, persisted citation reads, and original-file preview using a dedicated
test account. Vercel and Knowhere Logfire records must show no upstream demo
materialization calls from the new client and the correct shared namespace and
document filters. Unit tests and guest reads do not replace authenticated
production acceptance.

No schema migration, private-copy deletion, SDK upgrade, or Knowhere backend
change is required. A Notebook deployment rollback leaves the retired
upstream endpoint retired and may restore the original demo-chat failure.
