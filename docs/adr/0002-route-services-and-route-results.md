# ADR 0002: Use Route Services And Shared Route Results

## Status

Accepted

## Context

Notebook route handlers previously mixed HTTP parsing, authentication context,
domain workflow, and `NextResponse` serialization. Chat and Source routes also
repeated the same `{ status, body }` response shape.

## Decision

Use Route Services for route workflow behavior and return shared route-result
values. Next.js route handlers should parse HTTP primitives, read Route
Context, call a Route Service, and serialize through the shared Next route
response adapter.

## Consequences

Route Services can be tested without constructing `NextRequest` or
`NextResponse` objects.

When a route needs a new request shape, add a request adapter near the domain
workflow instead of growing inline parsing inside `app/api/**/route.ts`.
