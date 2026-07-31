# ADR 0008: Remove demo, guest mode, and Official Library

**Date:** 2026-07-31

## Status

Accepted

## Context

The Notebook shipped with a demo catalog system that served static content to
anonymous (guest) users and an Official Library panel that let authenticated
users browse and materialize curated demo sources into their workspace. This
added significant complexity across every layer:

- **DB schema:** `demo_source_visibilities` table, `demo_key` columns on
  `sources` and `chat_threads`, and associated indexes.
- **Domain layer:** `src/domains/demo/`, `src/integrations/knowhere-demo.ts`,
  `demo-source-repository.ts`, demo catalog fetching in route listing,
  demo chunk page loading, demo chat thread seeding, demo asset URL
  hardening, hidden-demo-source filtering, and materialization workflow.
- **UI layer:** `OfficialLibraryPanel`, library overlay state, guest-mode
  plumbing (`isGuest`, `loginUrl`, `onLoginClick`), `ContentView` type with
  `"library"` variant, and `addingLibrarySourceIds` workflow state.
- **Proxy:** Guest source-read path regexes and demo asset/original path
  allowlist for anonymous access.

The self-hosted deployment does not use the demo catalog or the Official
Library. All real documents come from Knowhere namespaces. Guest mode provided
no value without the demo catalog.

## Decision

Remove demo, guest mode, and the Official Library entirely:

1. **Delete** all demo-specific files: `src/integrations/knowhere-demo.ts`,
   `src/domains/demo/`, `src/app/api/demo-sources/`,
   `src/components/official-library-panel.tsx`, `src/domains/sources/demo-source-repository.ts`,
   and demo static assets (`public/images/official-library/`,
   `public/icons/official-library/`).

2. **Simplify `SourceKind`** to `"workspace" | "remote"` (the `"demo"` variant
   is removed).

3. **Remove DB demo infrastructure:** drop `demo_source_visibilities` table,
   `sources.demo_key` column + index, `chat_threads.demo_key` column + index.

4. **Remove guest mode:** the proxy no longer allows anonymous source reads.
   Anonymous requests redirect to login. `getGuest()` is removed from
   `notebookRequestContext`. Unauthenticated SSR returns `{ sources: [] }`.

5. **Remove demo plumbing from domain/components:** `demoApi` deps,
   `fetchCatalog`, `hideDemoSource`, `listHiddenDemoSourceIds`,
   `upsertMaterializedDemoSource`, demo chat thread seeding, demo asset URL
   hardening, `materializeDemoSources` client method, `isGuest`/`loginUrl`
   props, `onOfficialLibrarySourceAdd`, `addingLibrarySourceIds`,
   `ContentView`/`onLibraryOpen`/`onLibraryBack`.

6. **Replace the Official Library panel with a namespace dropdown** in the
   sources panel header. The dropdown calls `GET /api/namespaces` (backed by
   Knowhere's `GET /v1/documents/namespaces`) and lets users import all
   documents from any namespace via `POST /api/namespaces/[namespace]/localize`.

7. **Eagerly localize compatible-namespace documents** on every source list
   load (both `GET /api/sources` and SSR). `localizeRemoteLibrarySources`
   pre-filters against existing DB rows by `knowhereDocumentId` so only
   genuinely new documents are upserted.

## Consequences

- **Simpler codebase:** ~6000 lines removed across 84 files.
- **No anonymous access:** self-hosted deployments require `KNOWHERE_API_KEY`
  for dev mode or Dashboard auth for production.
- **All sources are real:** no static/demo content. Sources are either
  `kind: "workspace"` (uploaded or localized DB rows) or `kind: "remote"`
  (transient Knowhere documents not yet localized).
- **Eager localization means new Knowhere documents appear automatically:**
  no user action needed. The pre-filter prevents write amplification on
  repeated list loads.
- **Namespace dropdown extends beyond compatible namespaces:** users can
  import from any Knowhere namespace, not just `default` and the workspace
  namespace. This replaces the curated Official Library with open access to
  all available namespaces.
- **DB schema is clean:** `db:push --force` on a fresh database creates the
  simplified schema without demo tables or columns.
