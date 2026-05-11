# ADR 0005: Keep Repository Facades Stable While Splitting Persistence Concerns

## Status

Accepted

## Context

Source and Chat persistence both grew around stable public repository exports,
but the implementation files started mixing several tables and workflow-specific
adapters. That made it harder to tell which module owned Source row lifecycle,
parse-result artifacts, Demo Source uploads, Chat Thread rows, Chat Message
writes, Demo Chat seeding, and Citation normalization.

## Decision

Keep public facades such as `sourceRepository` and `chatRepository` stable for
callers. Split their internal implementations by the knowledge they manage:
row lifecycle, artifact metadata, demo persistence, message persistence, and
normalization rules.

Upload workflows should keep their public `upload.ts` facade while moving
shared repository/client contracts into a contract module and separating user
Knowhere uploads from Demo Source seeding.

## Consequences

Route services and workspace services can keep importing the existing facades,
so repository refactors do not cascade through the app.

New persistence behavior should land in the internal repository module that
owns the relevant table or rule. Add facade members only when a caller needs a
new repository capability.
