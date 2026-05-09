import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ChunkType, ParsedChunkView, SourceView } from "./types";

type DemoSourceDefinition = {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly assetDirectory: string;
  readonly chunkCount: number;
};

type RawDemoChunk = {
  readonly chunk_id: string;
  readonly type: string;
  readonly content?: unknown;
  readonly path?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

const demoSourceDefinitions: readonly DemoSourceDefinition[] = [
  {
    id: "demo-tsla-q4-2025",
    documentId: "demo-doc-tsla-q4-2025",
    title: "TSLA-Q4-2025-Update.pdf",
    assetDirectory: "tsla-q4-2025",
    chunkCount: 71,
  },
  {
    id: "demo-epstein-flight-logs",
    documentId: "demo-doc-epstein-flight-logs",
    title: "EPSTEIN FLIGHT LOGS UNREDACTED.pdf",
    assetDirectory: "epstein-flight-logs",
    chunkCount: 117,
  },
] as const;

const demoAssetsDirectoryPath = path.join(
  process.cwd(),
  "public",
  "demo-sources",
);

function listSources(): SourceView[] {
  return demoSourceDefinitions.map((source) => ({
    id: source.id,
    title: source.title,
    status: "ready",
    documentId: source.documentId,
    chunkCount: source.chunkCount,
  }));
}

async function loadChunksForSource(
  sourceId: string,
): Promise<ParsedChunkView[] | null> {
  const source = demoSourceDefinitions.find(
    (candidate) => candidate.id === sourceId,
  );
  if (!source) return null;

  const filePath = path.join(
    demoAssetsDirectoryPath,
    source.assetDirectory,
    "chunks.json",
  );
  const body = await readFile(filePath, "utf8");
  const rawChunks = parseRawChunks(JSON.parse(body) as unknown);

  return rawChunks.map((chunk) => toParsedChunkView(source, chunk));
}

function parseRawChunks(value: unknown): readonly RawDemoChunk[] {
  if (!isRecord(value)) return [];

  const chunks = value["chunks"];
  if (!Array.isArray(chunks)) return [];

  return chunks.filter(isRawDemoChunk);
}

function isRawDemoChunk(value: unknown): value is RawDemoChunk {
  if (!isRecord(value)) return false;
  return (
    typeof value["chunk_id"] === "string" &&
    typeof value["type"] === "string"
  );
}

function toParsedChunkView(
  source: DemoSourceDefinition,
  chunk: RawDemoChunk,
): ParsedChunkView {
  const metadata = chunk.metadata ?? {};

  return {
    chunkId: `${source.id}:${chunk.chunk_id}`,
    documentId: source.documentId,
    sectionPath: getString(chunk.path) ?? null,
    type: toChunkType(chunk.type),
    content: getString(chunk.content) ?? "",
    summary: getStringMetadata(metadata, "summary"),
    keywords: getStringArrayMetadata(metadata, "keywords"),
    pageNums: getNumberArrayMetadata(metadata, "page_nums"),
    sourceTitle: source.title,
  };
}

function toChunkType(value: string): ChunkType {
  if (value === "image" || value === "table") return value;
  return "text";
}

function getStringMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  return getString(metadata[key]);
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getStringArrayMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string[] | undefined {
  const value = metadata[key];
  if (!Array.isArray(value)) return undefined;

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return strings.length > 0 ? strings : undefined;
}

function getNumberArrayMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): number[] | undefined {
  const value = metadata[key];
  if (!Array.isArray(value)) return undefined;

  const numbers = value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item),
  );
  return numbers.length > 0 ? numbers : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

export const demoData = {
  listSources,
  loadChunksForSource,
} as const;
