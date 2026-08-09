# Handoff: page chunks now carry query-hit snippets — notebook follow-ups

**Session ID:** knowhere-self-hosted / knowhere page-snippets work (PR #245)
**Created:** 2026-08-09
**For:** next session working in knowhere-notebook
**Status:** upstream fix DONE + verified live; notebook hardening NOT started

---

## TL;DR

The Knowhere retrieval API now returns **all query-term hits** for `page` chunks as
snippets (`content_source: "content_snippets"`, summary + up to 20 × ±100-char
windows), instead of only the LLM summary. The Gordon reproduction is fixed and
verified against the running stack. Three notebook-side follow-ups remain (M1–M3).

## Background & evidence

- Scenario: Labour Department Telephone Directory PDF → one giant `page` chunk
  (`node_59c79a94-...`, ~183K chars). Query "Gordon" matches twice
  (`CHEUNG Hon-lam Gordon`, `YUEN Chun-cheung Gordon`) but the old API returned
  only the chunk summary → notebook showed "null" / no usable evidence.
- Upstream fix: `Ontos-AI/knowhere` PR #245 (merged into local test image).
  API behavior now: page chunks return
  `content = summary + "\n\n" + <snippet…>`, `content_source="content_snippets"`.
- Verified live (query "Gordon", namespace `default`, bearer
  `sk_8aBdXbOvF_Qibah2-_BDNo1-VCd50A16CwfiremGVB8`):
  both `CHEUNG Hon-lam Gordon 2835 2147` and `YUEN Chun-cheung Gordon 3752 8030`
  appear in `results[].content`.
- SDK (`@ontos-ai/knowhere-sdk`, installed locally) already documents
  `contentSource` ("Page chunks normally expose summaries as content") and
  provides `chunkId` on both `RetrievalResult` and `RetrievalReferencedChunk`.
  `dataType` in the SDK allows `1|2|3|4|5|6|7|8`.

## Current repo state

- Branch: `feat/self-hosted-chunks-overlay-layout` (clean tree, committed).
- Verify with `pnpm test` (vitest), `pnpm typecheck` (tsc --noEmit), `pnpm lint` (eslint).
- Session notes live in `docs/session-notes/`.

---

## M1 — never render a literal "null" as answer/evidence

**Symptom:** the Gordon query rendered "null" in the chat output. Root cause was
upstream (empty page content) and is fixed, but the notebook has no guard if the
API ever returns missing/empty content again.

**Where to look (verify by reproducing first):**

- `src/domains/chat/index.ts`:
  - `mergeRetrievalResponses` (~line 642) — `answerText`/`evidenceText` are
    already filtered for truthiness; check nothing later stringifies `null`.
  - `collectRetrievalResults` (~line 970) and `mapDisplayedManifestArtifactsToResults`
    (~line 889) build `RetrievalResult` objects from harness ledger chunks.
- `src/agent-harness/ledger.ts` — `referenced_chunk` entries are added with
  `content: ""` (line 65); `read()` slices empty content. The harness prompt gets
  evidence via `evidenceText`; confirm a missing `evidenceText` never interpolates
  the literal string `null` into the prompt.
- UI render path: search for `.content ?? null`, `String(content)`, or template
  interpolation of `content` in the chat/notebook views.

**Acceptance:** a query returning zero usable content shows a graceful message
(e.g. the existing `NO_RESULTS_ANSWER`), never the literal text `null`.
Add a regression test in `src/domains/chat/service.test.ts` (or `index.test.ts`).

## M2 — citation fallback by `chunkId`

**Why:** citations are resolved by matching the citation's excerpt against chunk
content (`findByContent` in `src/domains/chunks/normalization.ts:209-222`). With
snippet-window content this match is fragile; the SDK now returns a stable
`chunkId` on every result/referenced chunk, so resolve by id first.

**Where to look:**

- `src/domains/chunks/normalization.ts`:
  - `resolveCitationChunkByContent` (102-110) → `findByContent` (209-222).
  - `findUniqueBySectionPath` (189-199) already exists as a fallback tier.
- `src/domains/chunks/index.ts:175` — `content_source` is already surfaced on
  parsed chunks; expose `chunkId` the same way if not already present.

**Suggested fallback order:** (1) exact `chunkId` match, (2) content excerpt
match (`findByContent`), (3) unique `sectionPath` match, (4) best-effort fuzzy.

**Acceptance:** a citation whose content is a snippet window still highlights the
correct page chunk; unit tests in `src/domains/chunks/normalization` and
`src/domains/chat/citations.test.ts`.

## M3 — explicit `dataType: 7` (page) mapping

**Why:** `AgenticRetrievalTargetContent` (`src/domains/chat/contracts.ts:26-33`)
is `all|text|image|table|text_image|text_table` → mapped to dataType 1–6 in
`RETRIEVAL_TARGET_CONTENT_DATA_TYPES` (`src/domains/chat/index.ts:54-63`).
`page` (dataType 7) is unreachable from the agentic planner, even though page
chunks are exactly where name/directory lookups live.

**Where to look:**

- `src/domains/chat/contracts.ts:26-33` — add `"page"` to the union.
- `src/domains/chat/index.ts:54-63` — add `page: 7`.
- `src/domains/chat/prompt.ts:139` `toAgenticRetrievalTargetContent` — accept a
  page target (e.g. when the query looks like a directory/name lookup).
- `src/agent-harness/` — check the router/tool-schema path tolerates dataType 7
  (the SDK allows it; the gateway rejected only invalid enum values, see
  `route-service.test.ts:193`).
- Update planner tests (`index.test.ts`, `service.test.ts`, `prompt` tests) with
  `dataType: 7` cases.

**Acceptance:** the planner can emit a `page`-targeted query when the question is
a name/directory lookup; the query reaches the API with `dataType: 7`; page
results flow into evidence as usual.

---

## Verification (end-to-end)

1. Run against the local stack: API at `http://127.0.0.1:5005`, dashboard
   `http://127.0.0.1:3000`, API key above, namespace `default`, document
   "Telephone Directory" (`doc_8bdafc56ab18`).
2. Query "Gordon" — answer must cite both directory entries with the matching
   lines visible as evidence (snippet content, not "null", not summary-only).
3. `pnpm test && pnpm typecheck && pnpm lint` before committing.

## Gotchas

- `referenced_chunk` ledger entries intentionally have `content: ""`
  (`ledger.ts:65`) — content flows through `evidenceText`, not the chunk body.
- `contentSource` values seen so far: `summary` (old page behavior) and
  `content_snippets` (new). Treat unknown values as safe-to-render content.
- The local test image (`knowhere-self-hosted:test-all-features`) has PR #245;
  upstream merge/release timing affects when this lands for notebook users.
- Never re-verify "Gordon" against an image built before the PR — it will fail.
