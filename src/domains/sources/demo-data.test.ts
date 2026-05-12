import { describe, expect, it } from "vitest";

import type { ParsedChunkView } from "@/domains/chunks/types";
import type { SourceView } from "@/domains/sources/types";

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
        chunkCount: 70,
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

    expect(tslaChunks).toHaveLength(70);
    expect(tslaChunks?.[0]).toMatchObject({
      chunkId: "demo-tsla-q4-2025:15bcc860-b8d0-50c6-a627-66dbae67acd4",
      documentId: "demo-doc-tsla-q4-2025",
      sectionPath: "tables/table-0 Tesla 2025 Results.html",
      type: "table",
      sourceTitle: "TSLA-Q4-2025-Update.pdf",
    });
    expect(tslaChunks?.[0]?.content).toContain("<table>");
    expect(tslaChunks?.[0]?.summary).toContain("Tesla reported strong 2025");
  });

  it("loads page numbers from the static guest chunks", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");
    const tslaChunks = await demoModule.demoData!.loadChunksForSource(
      "demo-tsla-q4-2025",
    );

    expect(tslaChunks?.every((chunk) => chunk.pageNums?.length)).toBe(true);
    expect(tslaChunks?.[0]?.pageNums).toEqual([11]);
    expect(
      tslaChunks?.find(
        (chunk) =>
          chunk.sectionPath ===
          "Default_Root/TSLA-Q4-2025-Update.pdf-->SUMMARY-->Automotive",
      )?.pageNums,
    ).toEqual([8]);
    expect(
      tslaChunks?.find(
        (chunk) => chunk.filePath === "images/image-5-Tesla Model Y Driving.jpg",
      )?.pageNums,
    ).toEqual([15]);
    expect(tslaChunks?.at(-1)?.pageNums).toEqual([34]);
  });

  it("encodes static asset urls so reserved filename characters stay in the path", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");
    const tslaChunks = await demoModule.demoData!.loadChunksForSource(
      "demo-tsla-q4-2025",
    );

    const modelYImageChunk = tslaChunks?.find(
      (chunk) => chunk.filePath === "images/image-5-Tesla Model Y Driving.jpg",
    );

    expect(modelYImageChunk?.assetUrl).toBe(
      "/demo-sources/tsla-q4-2025/images/image-5-Tesla%20Model%20Y%20Driving.jpg",
    );
  });

  it("returns null for unknown guest source ids", async () => {
    const demoModule: DemoDataModule = await import("./demo-data");

    await expect(
      demoModule.demoData?.loadChunksForSource("missing-source"),
    ).resolves.toBeNull();
  });
});
