# ADR 0006: Split Feature UI Into Focused Render And State Modules

## Status

Accepted

## Context

Notebook UI panels had accumulated row rendering, dialog state, message lists,
history sheets, chunk cards, preview adapters, and orchestration in a small
number of large components. That made visual changes risky because local UI
behavior was coupled to parent panel state.

## Decision

Keep panel components as composition points. Move repeated or stateful UI pieces
into feature-named modules such as Source Row, Source Upload Dialog, Chat
Composer, Chat History Sheet, Chat Message List, Parsed Chunk Card, and Source
Original Preview adapters.

Render-only modules receive already-derived state and callbacks. Model modules
own formatting and classification logic that can be tested without rendering
React.

## Consequences

New UI behavior should first choose the smallest feature module that owns the
interaction. Parent panels should grow only when they need to coordinate between
multiple child modules.

Tests should follow the same ownership: formatting/model tests for pure modules,
component tests for local interaction, and panel tests only for cross-module
composition.
