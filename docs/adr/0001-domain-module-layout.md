# ADR 0001: Organize Notebook Code By Domain Modules

## Status

Accepted

## Context

Notebook code started with most behavior in a few large files. That made the
Workspace, Source, Parsed Chunk, Chat Thread, and Citation concepts harder to
find because knowledge was grouped by execution order instead of by the domain
concept it managed.

## Decision

Keep domain behavior under `src/domains/<domain>/` and UI orchestration under
`src/components/` modules named for Notebook concepts from `CONTEXT.md`.

Route handlers should stay thin HTTP adapters. Domain modules should own the
workflow and expose small interfaces that callers can test directly.

## Consequences

New behavior should first look for an existing domain module before creating a
generic utility in `src/lib`.

It is acceptable for a domain folder to contain several small files when each
file owns a real concept. Avoid pass-through modules that only rename another
function without adding locality.
