import { describe, expect, it } from "vitest";

import type { ParsedChunkView, SourceView } from "./types";

type DemoDataModule = {
  readonly demoData?: {
    readonly listSources: () => readonly SourceView[];
    readonly loadChunksForSource: (
      sourceId: string,
    ) => Promise<readonly ParsedChunkView[] | null>;
  };
};

describe("demoData", () => {
  it("exposes the fixed guest sources with real chunk counts", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");
    const sources = demoModule.demoData?.listSources();

    expect(sources).toEqual([
      {
        id: "demo-tsla-q4-2025",
        title: "TSLA-Q4-2025-Update.pdf",
        status: "ready",
        documentId: "demo-doc-tsla-q4-2025",
        chunkCount: 71,
      },
      {
        id: "demo-epstein-flight-logs",
        title: "EPSTEIN FLIGHT LOGS UNREDACTED.pdf",
        status: "ready",
        documentId: "demo-doc-epstein-flight-logs",
        chunkCount: 117,
      },
    ]);
  });

  it("loads parsed chunks from the static guest packages", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");
    expect(typeof demoModule.demoData?.loadChunksForSource).toBe("function");

    const tslaChunks = await demoModule.demoData!.loadChunksForSource(
      "demo-tsla-q4-2025",
    );
    const epsteinChunks = await demoModule.demoData!.loadChunksForSource(
      "demo-epstein-flight-logs",
    );

    expect(tslaChunks).toHaveLength(71);
    expect(tslaChunks?.[0]).toMatchObject({
      chunkId: "demo-tsla-q4-2025:53f41a6a-259f-596d-92eb-0e6b7141e849",
      documentId: "demo-doc-tsla-q4-2025",
      sectionPath:
        "tables/table-1 Profitability $4.4B GAAP operating... 2025 marked a critic....html",
      type: "table",
      sourceTitle: "TSLA-Q4-2025-Update.pdf",
    });
    expect(tslaChunks?.[0]?.content).toContain("<table>");
    expect(tslaChunks?.[0]?.summary).toContain("Tesla reported 2025");

    expect(epsteinChunks).toHaveLength(117);
    expect(epsteinChunks?.[1]).toMatchObject({
      chunkId: "demo-epstein-flight-logs:cb11d193-e9a2-b62e-fe97-e9351b7c0b53",
      documentId: "demo-doc-epstein-flight-logs",
      sectionPath: "tables/Flight Log 11_17_1995 - 1_28_1996.html",
      type: "table",
      sourceTitle: "EPSTEIN FLIGHT LOGS UNREDACTED.pdf",
      pageNums: [1],
    });
    expect(epsteinChunks?.[1]?.keywords).toContain("PBI");
  });

  it("returns null for unknown guest source ids", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");

    await expect(
      demoModule.demoData?.loadChunksForSource("missing-source"),
    ).resolves.toBeNull();
  });
});
