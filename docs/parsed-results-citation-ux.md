# Parsed Results + citation UX

Recorded 2026-08-18 so we do not relitigate the Figma / issue discussion.

Sources:

- Figma [Knowhere (Copy) / brain](https://www.figma.com/design/0jjj7SQ1N0zo4D9WzJoNJh/Knowhere--Copy-?node-id=4000-37742) (`4000:37742`)
- GitHub [knowhere#222](https://github.com/Ontos-AI/knowhere/issues/222), [knowhere#223](https://github.com/Ontos-AI/knowhere/issues/223)
- Product lock from that conversation (issues and Figma notes are partly stale)

This work lands in **Knowhere Notebook**. Region geometry later lands in **Knowhere retrieval** (`Ontos-AI/knowhere`) and is only consumed here when the payload exists.

## Locked product

Vision / page-image mode only. There is **no original PDF preview** as a citation destination.

| Topic | Decision |
| --- | --- |
| Layout | Sources \| Parsed Results \| Assistant (today’s Notebook columns). Ignore the Figma frame that put Assistant in the middle. |
| Rename | Knowhere Notebook → **Knowhere Brain** |
| Canvas | Title **Parsed Results**, subtitle **From {source title}** |
| Page card | **Page N + parse path**, page image, keywords. No keywords → hide the keyword row, still show the image. Screen 2 “text” is a crop overlay on the page image, not a text chunk. |
| List / Tree | Keep **both**. Tree is the **existing** section tree, also in page-image mode. **Default Tree**. Citation click may switch to List so the page card is visible. |
| Inline chips | One chip **per citation**, not per page. Label `{source title}/pN` (same name as the Sources row). Max width 250px, truncate. Same page can be two chips; later they get different crop boxes. |
| Chip / `pN` click | Switch the **viewed** source if needed (not query checkboxes), open that file’s parsed page, scroll to it. Chat may cite any workspace file while the canvas shows another. |
| Footer SOURCES | Numbered list, one row per file, `{title}` + cited page links `p25 p26 p27`. Those links do the **same jump** as chips. |
| Copy / download | Copy answer / code / tables. Download **this assistant turn** as **Markdown and PDF**, **without citations** (no chips, no SOURCES list). |
| Region box | **Required product**, **not this slice**. When retrieval sends a crop, draw `#8E51FF` / 25% / 8px radius on that page image (flash twice, 3s, fade). Until then, page jump only. Do not fake a full-page box. |

Out of this slice: original-file viewer for citations, region overlay, faking geometry.

## Current code (gaps)

Almost all of this is UI in this repo. Page images, keywords, page numbers, and source-title chips already exist in pieces.

| Area | Today | Need |
| --- | --- | --- |
| Branding | “Knowhere Notebook” in `top-nav.tsx`, `lib/app-metadata.ts`, login, `global-error.tsx` | Brain |
| Canvas copy | “Parsed Chunks” / “Showing all parsed chunks from …” | Parsed Results / From {title} |
| Original preview | Hidden for `page-assets` sources (`chunks-panel.tsx`) | Keep hidden. Citations must not reopen it. |
| List / Tree | Tree **hidden** for page-asset sources (`!isPageAssetSource`). Default mode is already `"tree"` but unused in page mode. | Show the toggle for page mode; Tree uses existing `ChunkSectionTree`. |
| Page cards | `PageChunkCard` already shows page image + `ChunkKeywords` | Match Figma title (`Page N` + path). Image-first. Hide keywords when empty (already returns null). |
| Inline chips | `[Source N: …]` tokens are **stripped** (`buildCitationContentMarkdown`). Chips live in a footer `AssistantSources`. | Replace tokens with inline `{title}/pN` chips in the answer. |
| Chip label | Filename / source title only, **no `/pN`**. | `{title}/pN` |
| Dedupe | `getDisplayCitations` and `selectCitationRawResults` drop same-key citations. | Keep one chip per citation so two regions on one page stay two chips. |
| Footer SOURCES | Flat chips | Numbered per-file list + page links |
| Click target | `handleCitationClick` focuses a **chunk**. `focusedPage` is plumbed to `ChunksPanel` but **not used**. | Focus/scroll the **page** card; `onSelectSource` for file B while viewing A already exists. |
| Export | None | Per-turn copy + MD/PDF without citations |

Later API (do not block Notebook UI):

- Retrieval / agent citation payload has page number and page image today (`pageCitationPageNumber`, `pageCitationAssetUrl`).
- It does **not** have a citation crop box. Worker bboxes are for asset crops, not “this quote lives here.”
- When Knowhere adds a region on the citation, extend `ChatCitationView` + persistence, then overlay on `PageCitationAssetImage`.

## Implementation slices (Notebook)

Do these in order. Tests follow existing ownership: model tests for labels/grouping, component tests for chips/cards/export, panel tests for click → source + page.

1. **Chrome** — rename Brain; Parsed Results header/subtitle; enable List/Tree on page-asset sources; default Tree.
2. **Page cards** — Figma card header (page + path); image + optional keywords; citation click forces List (already does via `citationListViewRequestId`) and scrolls to the page chunk.
3. **Citations** — stop stripping without replacement; inline chips `{title}/pN`; stop collapsing same-page citations; numbered SOURCES with `pN` links; click switches viewed source and page-focuses.
4. **Copy / download** — message actions: clipboard of visible answer (code/tables included as rendered); MD + PDF of this turn with the same citation-stripped body we already produce for display (`buildCitationContentMarkdown` / equivalent). PDF is client-side from that Markdown, not the original document.
5. **Later** — region overlay when retrieval sends a box. Keep citation identity stable (do not key chips by `title+page` only).

## Do not

- Route citation clicks to original PDF preview.
- Deduplicate inline chips by page.
- Draw a highlight without retrieval geometry.
- Change which sources are **checked for the next query** when jumping the canvas.
- Put this feature in archived `knowhere-api`; new retrieval fields go in `Ontos-AI/knowhere`.
