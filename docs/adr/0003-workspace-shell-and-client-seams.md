# ADR 0003: Keep Workspace Shell Orchestration Separate From Layout And Transport

## Status

Accepted

## Context

The Workspace Shell coordinates Sources, Parsed Chunks, Chat Threads, Citation
Focus, and responsive panel layout. Keeping SWR keys, HTTP transport, workflow
state, and JSX layout in one module made the Shell hard to scan and expensive
to change.

## Decision

Keep the Workspace Shell as the orchestration module. Move render-only panel
composition into Workspace Shell Layout, browser route calls into Workspace
Client, and Effect HTTP transport into a Route Client adapter.

Desktop panel resize state, selected Source chunk pagination, Citation Focus,
and Source/Chat state transitions should live in small tested modules with
domain names.

## Consequences

UI changes should avoid adding route paths, SWR keys, or HTTP transport details
directly to Workspace Shell Layout.

Workflow changes should be tested through the state or client module interfaces
before they are wired into the Shell.

The Shell can still coordinate cross-workflow behavior, but should not own
browser measurement details, SWR key construction, or render-only panel
composition inline.
