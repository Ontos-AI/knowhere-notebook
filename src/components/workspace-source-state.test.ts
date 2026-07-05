import { describe, expect, it } from "vitest";

import { workspaceSourceState } from "./workspace-source-state";

import type { SourceView } from "@/domains/sources/types";

describe("workspaceSourceState", () => {
  it("selects the first ready Source as the initial Source", () => {
    const sources: readonly SourceView[] = [
      {
        id: "source_parsing",
        title: "pending.pdf",
        status: "parsing",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
      {
        id: "source_ready",
        title: "ready.pdf",
        status: "ready",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
    ];

    expect(workspaceSourceState.getInitialSelectedSourceId(sources)).toBe(
      "source_ready",
    );
  });

  it("can select an unmaterialized Official Library row for preview", () => {
    const sources: readonly SourceView[] = [
      {
        id: "demo-spacex-s1",
        kind: "demo",
        demoSourceId: "demo-spacex-s1",
        title: "spacex-s1.pdf",
        status: "ready",
        mimeType: "application/pdf",
        excludedFromQuery: false,
        officialLibrary: {
          librarySourceId: "financial-spacex-s1",
          categoryId: "financial-reports",
          sourceUrl: "https://example.com/spacex-s1.pdf",
        },
      },
      {
        id: "source_ready",
        title: "ready.pdf",
        status: "ready",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
    ];

    expect(workspaceSourceState.getInitialSelectedSourceId(sources)).toBe(
      "demo-spacex-s1",
    );
  });

  it("selects a preferred document source when opening a chunk-tree link", () => {
    const sources: readonly SourceView[] = [
      {
        id: "source_first",
        title: "first.pdf",
        status: "ready",
        mimeType: "application/pdf",
        documentId: "doc_first",
        excludedFromQuery: false,
      },
      {
        id: "source_target",
        title: "target.pdf",
        status: "ready",
        mimeType: "application/pdf",
        documentId: "doc_target",
        excludedFromQuery: false,
      },
    ];

    expect(
      workspaceSourceState.getInitialSelectedSourceId(sources, "doc_target"),
    ).toBe("source_target");
  });

  it("keeps a localized remote document selected after source refresh", () => {
    const sources: readonly SourceView[] = [
      {
        id: "source_localized",
        kind: "workspace",
        title: "remote.pdf",
        status: "ready",
        mimeType: "application/pdf",
        documentId: "doc_remote",
        excludedFromQuery: false,
      },
    ];

    expect(
      workspaceSourceState.getResolvedSelectedSourceId(
        sources,
        "knowhere-doc:default:doc_remote",
      ),
    ).toBe("source_localized");
  });

  it("keeps an explicit non-ready Source selected instead of falling back", () => {
    const sources: readonly SourceView[] = [
      {
        id: "source_pending",
        title: "pending.pdf",
        status: "parsing",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
      {
        id: "source_ready",
        title: "ready.pdf",
        status: "ready",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
    ];

    expect(
      workspaceSourceState.getResolvedSelectedSourceId(
        sources,
        "source_pending",
      ),
    ).toBe("source_pending");
  });

  it("does not resolve a stale selected Source to an unrelated ready Source", () => {
    const sources: readonly SourceView[] = [
      {
        id: "demo_ready",
        kind: "demo",
        demoSourceId: "demo_ready",
        title: "demo.pdf",
        status: "ready",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
    ];

    expect(
      workspaceSourceState.getResolvedSelectedSourceId(
        sources,
        "source_stale",
      ),
    ).toBeNull();
  });

  it("applies source query exclusions without mutating the source list", () => {
    const sources: readonly SourceView[] = [
      {
        id: "source_1",
        title: "included.pdf",
        status: "ready",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
      {
        id: "source_2",
        title: "excluded.pdf",
        status: "ready",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
    ];

    const updated = workspaceSourceState.applyQueryExclusions(sources, {
      source_2: true,
    });

    expect(updated).toEqual([
      expect.objectContaining({
        id: "source_1",
        excludedFromQuery: false,
      }),
      expect.objectContaining({
        id: "source_2",
        excludedFromQuery: true,
      }),
    ]);
    expect(sources[1]?.excludedFromQuery).toBe(false);
  });

  it("moves selection to the first remaining ready Source when the selected Source is archived", () => {
    const sources: readonly SourceView[] = [
      {
        id: "source_1",
        title: "selected.pdf",
        status: "ready",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
      {
        id: "source_2",
        title: "remaining.pdf",
        status: "ready",
        mimeType: "application/pdf",
        excludedFromQuery: false,
      },
    ];
    const result = workspaceSourceState.archiveSource({
      sourceId: "source_1",
      selectedSourceId: "source_1",
      sources,
      sourceExclusionById: {
        source_1: true,
        source_2: false,
      },
    });

    expect(result).toEqual({
      selectedSourceId: "source_2",
      sourceExclusionById: {
        source_2: false,
      },
    });
  });
});
