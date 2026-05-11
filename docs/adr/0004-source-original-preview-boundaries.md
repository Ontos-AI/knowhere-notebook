# ADR 0004: Split Source Original Preview Model And Requests From Rendering

## Status

Accepted

## Context

Source Original Preview supports images, PDFs, text, Markdown, DOCX rendering,
download links, preview size limits, and cancellable browser file reads. Keeping
all classification, sizing, request, and render logic inside one component made
preview changes risky and left raw network behavior inside JSX modules.

## Decision

Keep `SourceOriginalPreview` as the render and hook owner. Move file
classification, preview limits, download URL rules, and PDF sizing math into a
pure preview model. Move text and binary reads behind a request helper that
preserves the component-owned `AbortSignal`.

## Consequences

Preview behavior can be tested without rendering React. File-read behavior can
be tested without mounting the full preview component, and future preview
formats should extend the model/request boundaries before adding more logic to
the UI component.
