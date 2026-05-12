import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveCitationChunk } from "../chunks";
import { DEMO_CHAT_MESSAGES } from "./demo";
import type { ParsedChunkView } from "@/domains/chunks/types";

type RawDemoChunk = {
  readonly chunk_id: string;
  readonly type: string;
  readonly content?: unknown;
  readonly path?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

describe("DEMO_CHAT_MESSAGES", () => {
  it("uses citations that resolve to bundled TSLA demo chunks", () => {
    const chunks = loadTslaDemoChunks();
    const citations = DEMO_CHAT_MESSAGES.flatMap((message) =>
      message.citations ?? [],
    );

    expect(citations.length).toBeGreaterThan(0);
    for (const citation of citations) {
      expect(resolveCitationChunk(citation, chunks)?.chunkId).toBeTruthy();
    }
  });

  it("keeps assistant examples aligned with single-result demo retrieval", () => {
    const assistantMessages = DEMO_CHAT_MESSAGES.filter(
      (message) => message.role === "assistant",
    );

    expect(assistantMessages).toHaveLength(3);
    for (const message of assistantMessages) {
      expect(message.citations).toHaveLength(1);
    }
  });

  it("uses latest parser section paths for demo citations", () => {
    const citations = DEMO_CHAT_MESSAGES.flatMap((message) =>
      message.citations ?? [],
    );

    expect(citations.map((citation) => citation.source.sectionPath)).toEqual([
      "Default_Root/TSLA-Q4-2025-Update.pdf-->OTHER UPDATES",
      "Default_Root/TSLA-Q4-2025-Update.pdf-->SUMMARY-->Energy generation and storage",
      "Default_Root/TSLA-Q4-2025-Update.pdf-->OUTLOOK-->Product",
    ]);
    expect(
      citations.every(
        (citation) =>
          citation.source.sourceFileName === "TSLA-Q4-2025-Update.pdf",
      ),
    ).toBe(true);
  });
});

function loadTslaDemoChunks(): ParsedChunkView[] {
  const filePath = path.join(
    process.cwd(),
    "public",
    "demo-sources",
    "tsla-q4-2025",
    "chunks.json",
  );
  const rawBody = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  const rawChunks = parseRawDemoChunks(rawBody);

  return rawChunks.map((chunk) => ({
    chunkId: `demo-tsla-q4-2025:${chunk.chunk_id}`,
    parserChunkId: chunk.chunk_id,
    documentId: "demo-doc-tsla-q4-2025",
    sectionPath: getString(chunk.path) ?? null,
    type: toChunkType(chunk.type),
    content: getString(chunk.content) ?? "",
    sourceTitle: "TSLA-Q4-2025-Update.pdf",
    summary: getString(chunk.metadata?.summary),
  }));
}

function parseRawDemoChunks(value: unknown): readonly RawDemoChunk[] {
  if (!isRecord(value) || !Array.isArray(value.chunks)) return [];

  return value.chunks.filter(isRawDemoChunk);
}

function isRawDemoChunk(value: unknown): value is RawDemoChunk {
  return (
    isRecord(value) &&
    typeof value.chunk_id === "string" &&
    typeof value.type === "string"
  );
}

function toChunkType(value: string): ParsedChunkView["type"] {
  if (value === "image" || value === "table") return value;
  return "text";
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}
