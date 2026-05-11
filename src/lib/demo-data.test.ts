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
  it("exposes only the TSLA guest source with its real chunk count", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");
    const sources = demoModule.demoData?.listSources();

    expect(sources).toEqual([
      {
        id: "demo-tsla-q4-2025",
        title: "TSLA-Q4-2025-Update.pdf",
        mimeType: "application/pdf",
        status: "ready",
        documentId: "demo-doc-tsla-q4-2025",
        chunkCount: 71,
        originalFile: {
          url: "/demo-sources/tsla-q4-2025/original.pdf",
          mimeType: "application/pdf",
          canDownload: false,
        },
      },
    ]);
  });

  it("loads parsed chunks from the static guest packages", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");
    expect(typeof demoModule.demoData?.loadChunksForSource).toBe("function");

    const tslaChunks = await demoModule.demoData!.loadChunksForSource(
      "demo-tsla-q4-2025",
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
  });

  it("encodes static asset urls so reserved filename characters stay in the path", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");
    const tslaChunks = await demoModule.demoData!.loadChunksForSource(
      "demo-tsla-q4-2025",
    );

    const productImageChunk = tslaChunks?.find(
      (chunk) => chunk.filePath === "images/image-5-# Product .jpg",
    );

    expect(productImageChunk?.assetUrl).toBe(
      "/demo-sources/tsla-q4-2025/images/image-5-%23%20Product%20.jpg",
    );
  });

  it("returns null for unknown guest source ids", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");

    await expect(
      demoModule.demoData?.loadChunksForSource("missing-source"),
    ).resolves.toBeNull();
  });
});
