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

  it("can select a workspace Source row for preview", () => {
    const sources: readonly SourceView[] = [
      {
        id: "source_spacex",
        kind: "workspace",
        title: "spacex-s1.pdf",
        status: "ready",
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
      "source_spacex",
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
