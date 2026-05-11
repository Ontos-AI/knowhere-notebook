import { describe, expect, it } from "vitest";

import { workspaceSourceState } from "./workspace-source-state";

import type { SourceView } from "@/domains/sources/types";

describe("workspaceSourceState", () => {
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

  it("clears selected and exclusion state when the selected source is archived", () => {
    const result = workspaceSourceState.archiveSource({
      sourceId: "source_1",
      selectedSourceId: "source_1",
      sourceExclusionById: {
        source_1: true,
        source_2: false,
      },
    });

    expect(result).toEqual({
      selectedSourceId: null,
      sourceExclusionById: {
        source_2: false,
      },
    });
  });
});
