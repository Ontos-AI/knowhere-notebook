# Knowhere Notebook Domain Context

This file names the product concepts used by the Notebook codebase. Use these
terms when naming modules, tests, and route workflows.

## Workspace

A Workspace is the Notebook-owned tenant container for a Dashboard user. It
stores the local source metadata, chat threads, and the Knowhere namespace used
for retrieval. Workspace creation is idempotent per Dashboard user.

## Workspace Shell

The Workspace Shell is the client-side orchestrator for the Notebook work
surface. It composes Source selection, Parsed Chunk pagination, Chat Thread
state, Citation focus, and panel layout into the visible three-panel notebook.

## Workspace Shell Layout

The Workspace Shell Layout is the render-only module for desktop and mobile
workspace panels. It receives already-derived state and callbacks from the
Workspace Shell and should not own route calls, SWR keys, or workflow state.

## Workspace Client

The Workspace Client is the browser-side adapter for Notebook route calls and
SWR keys. UI modules should depend on this adapter instead of constructing
route paths or mutation request shapes inline.

## Workspace Desktop Panels

Workspace Desktop Panels is the hook that owns browser measurements and resize
drag state for the three desktop panels. Pure resize math stays in Workspace
Shell State.

## Workspace Resize Handle Workflow

Workspace Resize Handle Workflow owns desktop resize-handle pointer lifecycle:
starting drag gestures, tracking pointermove deltas, and cleaning up window
listeners on pointerup.

## Workspace Selected Chunks

Workspace Selected Chunks is the hook that owns selected Source chunk paging,
prefetched Citation Focus chunks, and "load more" state. The Workspace Shell
uses it as derived workflow state instead of owning SWRInfinite details inline.

## Source

A Source is a document visible in the Notebook sources panel. Notebook persists
source metadata locally, while parsed content and retrieval live in Knowhere.
Sources are soft-deleted with `deletedAt` rather than removed.

## Source Repository

The Source Repository is a stable facade over smaller persistence modules. It
composes Source row lifecycle, Demo Source persistence, and Source Parse Result
artifact metadata without exposing those internal modules to route services.

## Source Library Localization

Source Library Localization is the workflow that turns Knowhere-owned library
documents into Notebook Source rows for a Workspace. Listing and chat should
localize missing Knowhere documents before chunks, archive, selection, or
retrieval flows act on them.

## Source Upload

A Source Upload is the workflow that turns either a browser `File` or a
Vercel Blob staged object into a Knowhere parsing job plus local source row.
Large files should use the Blob-backed path instead of a Server Action upload.

## Source Upload Contract

The Source Upload Contract names the repository and Knowhere client shapes used
by upload workflows. Persistence adapters can depend on the contract without
importing the user-upload or Demo Source workflow implementation.

## Source Row

A Source Row is the sidebar item for one Source. It owns include/exclude,
selection, status display, and local archive affordances for that one Source.

## Source Upload Dialog

The Source Upload Dialog is the upload UI for authenticated users. It renders
the upload controls and delegates file selection, drag-and-drop selection,
submission state, and upload errors to the Source Upload Dialog Workflow.

## Source Upload Dialog Workflow

Source Upload Dialog Workflow owns browser upload dialog behavior: open state,
selected file state, drag-and-drop selection, upload submission, friendly error
messages, duplicate-submit prevention, and post-upload cleanup.

## Demo Source

A Demo Source is app-owned static content served to guest users and optionally
materialized into an authenticated workspace. Demo sources should not depend on
live workspace state for guest rendering.

## Source Original Preview

Source Original Preview is the browser-side read-only view for a Source's
original file. Its model owns file classification, preview limits, download URL
rules, and PDF sizing math; request helpers own file reads so the component
can stay focused on rendering.

## Source Original PDF Workflow

Source Original PDF Workflow owns browser PDF preview behavior: loading the
`react-pdf` module, setting the PDF worker, measuring page width, loading page
aspect ratios, and tracking visible pages for lazy rendering.

## Source Original DOCX Workflow

Source Original DOCX Workflow owns browser DOCX preview behavior: loading the
source bytes, importing the DOCX renderer, falling back to Mammoth HTML
conversion, sanitizing rendered output, and cleaning up in-flight work.

## Source Original Text Workflow

Source Original Text Workflow owns browser text and Markdown preview behavior:
loading source text, tracking URL-scoped load state, and cleaning up in-flight
text requests.

## Parsed Chunk

A Parsed Chunk is a document chunk returned by the Knowhere document chunks
API. Parsed chunks can have parser chunk IDs, asset paths, page numbers,
summary, keywords, and connection metadata.

## Parsed Chunk Card

A Parsed Chunk Card renders one Parsed Chunk. It owns chunk source metadata,
content rendering, summaries, keywords, artifact references, and sanitized
table HTML for that card only.

## Chat Thread

A Chat Thread is a persisted Notebook conversation within one Workspace. Chat
threads are soft-deleted without deleting their messages.

## Chat Panel Workflow

Chat Panel Workflow owns browser chat panel behavior: chat history sheet open
state, new-chat actions, delete confirmation state, and archive confirmation
callbacks.

## Chat Repository

The Chat Repository is a stable facade over Chat Thread lifecycle, Chat Message
persistence, Demo Chat seeding, and Citation persistence normalization.

## Chat Message

A Chat Message is a persisted user or assistant message in a Chat Thread.
Assistant messages can store citation metadata, but should not persist full
source chunk text.

## Chat Message List Workflow

Chat Message List Workflow owns browser message-list behavior: virtual row
counts, thinking-progress row placement, viewport measurement, and automatic
scrolling to the latest row.

## Citation

A Citation is the metadata that connects an assistant answer to a retrieval
result. Fresh answers can include chunk content for focusing the UI; persisted
history stores only citation metadata.

## Citation Focus

Citation Focus is the workflow that maps a Citation back to a Source and Parsed
Chunk, optionally loading all chunks for that Source when paged chunks are not
enough to focus the answer evidence.

## Retrieval Query

A Retrieval Query is the text sent to Knowhere retrieval. It can be generated
from the latest user question plus recent chat context so Knowhere receives a
self-contained query.

## Dashboard Auth

Dashboard Auth is the source of truth for identity. Notebook forwards the
incoming Dashboard session cookie to Dashboard oRPC endpoints and does not
decode Dashboard session tokens itself.

## Dashboard Service JWT

A Dashboard Service JWT is a short-lived token issued by Dashboard and passed
to the Knowhere SDK for per-request access. Notebook does not create or store
Knowhere API keys.

## Route Service

A Route Service is a domain module that owns route workflow behavior and
returns route-ready data. Next.js route handlers should stay thin HTTP
adapters: parse HTTP primitives, call a Route Service, and serialize the
result.

## Route Context

Route Context is the small request-scoped adapter passed from Next.js route
handlers into Route Services. It contains HTTP-derived values such as the
incoming cookie header and keeps those primitives out of domain workflow code.
