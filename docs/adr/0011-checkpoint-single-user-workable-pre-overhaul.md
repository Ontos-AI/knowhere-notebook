# ADR 0011: Checkpoint — single-user workable, pre-overhaul

**Date:** 2026-08-02

## Status

Accepted (checkpoint marker, not a forward decision)

## Context

The Notebook currently ships a self-hosted, single-user-capable state:

- **Identity:** a single fake dev user (`knowhere-api-key-dev-user`), activated
  when `KNOWHERE_API_KEY` is set. The Dashboard production path (session-cookie
  forwarding + `issueServiceJwt`) still exists but is not used by self-hosted
  deployments.
- **Knowhere access:** one global API key from `KNOWHERE_API_KEY` env, used as
  the bearer for all Knowhere SDK calls.
- **Workspaces:** one workspace per user (`workspaces.user_id` unique), each
  with an auto-generated `notebook-<uuid>` namespace.
- **Chat:** answers work against localized sources, with retrieval tuning
  controls, foldable Sources/Retrieval blocks, and an answer-stats trace.

The next planned overhaul introduces multi-domain workspaces mapped to
Knowhere namespaces, then Notebook-owned authentication (users, DB sessions,
password login, Dashboard hard-cut), then DB-backed encrypted API keys.

This checkpoint exists so we can return to a known-good, single-user state if
the overhaul proves to be the wrong direction — for example, if we decide that
focusing on document input and answer quality matters more than multi-user
auth, or if the DIY-auth approach (argon2/Drizzle/Effect services) becomes
untenable.

## Decision

Mark commit `ae514fe` with the annotated tag:

```
checkpoint/single-user-workable-pre-overhaul
```

Message: "Single user workable, pre-overhaul to focus on document input and
quality of answers"

### What the checkpoint guarantees

- `KNOWHERE_API_KEY` dev-mode works end-to-end (proxy bypass, fake user,
  single global key).
- Chat retrieval is tuned for BM25 (rerank, multi-query, query expansion)
  with UI override controls.
- Sources/Retrieval blocks are foldable; the chat composer has a wand
  Prompts/Chart menu (JSON-served templates) and retrieval tuning sliders.
- Table chunks render server-side-enriched HTML.
- Working tree is clean; the current branch continues forward from here.

### How to return

```bash
# Try an alternative without losing current work:
git checkout -b alternative-plan checkpoint/single-user-workable-pre-overhaul

# Or just inspect:
git checkout checkpoint/single-user-workable-pre-overhaul
```

### Deferred alternatives this checkpoint keeps open

1. **Multi-domain model:** workspace = `(user, keyLabel, namespace)` with
   file/env-backed keys (fast switch, no restart), vs. DB-backed encrypted
   keys managed purely from the UI.
2. **Auth approach:** DIY (argon2 + Drizzle + Effect services, DB sessions,
   admin-provisioned users, Dashboard hard-cut) vs. Better Auth vs. Auth.js —
   see ADR 0010 (planned).
3. **Dashboard dependency:** whether to hard-cut Dashboard entirely in favor
   of Notebook-owned auth, or keep it as an optional fallback.
4. **Focus shift:** document input quality and answer quality improvements
   before or instead of multi-user auth work.

## Consequences

- The tag is immutable; later commits on the working branch do not move it.
- If the overhaul continues, subsequent checkpoints (`checkpoint/phase2-auth`,
  `checkpoint/phase3-db-keys`, …) should follow the same `checkpoint/` naming
  convention with a one-line status message.
- The tag message and this ADR are the source of truth for what the
  checkpoint state includes and what alternatives were deferred.
