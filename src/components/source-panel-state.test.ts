import { describe, expect, it } from "vitest";

import { sourcePanelState } from "./source-panel-state";
import type { SourceView } from "@/domains/sources/types";

const source: SourceView = {
  id: "source_1",
  title: "notes.pdf",
  mimeType: "application/pdf",
  status: "ready",
};

describe("sourcePanelState", () => {
  it("derives archive confirmation state from sources and pending ids", () => {
    const state = sourcePanelState.getArchiveConfirmationState({
      archivingSourceIds: ["source_1"],
      confirmSourceId: "source_1",
      sources: [source],
    });

    expect(state.confirmSource).toEqual(source);
    expect(state.isConfirmSourceArchiving).toBe(true);
    expect(state.archivingSourceIdSet.has("source_1")).toBe(true);
  });

  it("selects a Source from a row click without clearing the current selection", () => {
    expect(
      sourcePanelState.getNextSelectedSourceId({
        sourceId: "source_1",
      }),
    ).toBe("source_1");
    expect(
      sourcePanelState.getNextSelectedSourceId({
        sourceId: "source_1",
      }),
    ).toBe("source_1");
  });
});
