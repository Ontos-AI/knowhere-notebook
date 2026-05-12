import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { parsedChunkNormalization } from "../chunks/normalization";
import type { ParsedChunkView } from "@/domains/chunks/types";
import type { SourceView } from "@/domains/sources/types";

type DemoSourceDefinition = {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly mimeType: string;
  readonly originalFilePath: string;
  readonly originalSizeBytes: number;
  readonly assetDirectory: string;
  readonly chunkCount: number;
  readonly chatThreadTitle: string;
};

export type DemoSourceSeed = {
  readonly demoKey: string;
  readonly documentId: string;
  readonly title: string;
  readonly mimeType: string;
  readonly originalFileUrl: string;
  readonly originalFileSystemPath: string;
  readonly originalSizeBytes: number;
  readonly chunkCount: number;
  readonly chatThreadTitle: string;
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
    title: "TSLA-Q4-2025-Update(1).pdf",
    mimeType: "application/pdf",
    originalFilePath: "original.pdf",
    originalSizeBytes: 5648867,
    assetDirectory: "tsla-q4-2025",
    chunkCount: 70,
    chatThreadTitle: "TSLA demo conversation",
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
    mimeType: source.mimeType,
    status: "ready",
    documentId: source.documentId,
    chunkCount: source.chunkCount,
    originalFile: {
      url: parsedChunkNormalization.buildDemoAssetURL({
        assetDirectory: source.assetDirectory,
        filePath: source.originalFilePath,
      }),
      mimeType: source.mimeType,
      canDownload: false,
    },
  }));
}

function listSourceSeeds(): DemoSourceSeed[] {
  return demoSourceDefinitions.map(toDemoSourceSeed);
}

function getSourceSeedByDemoKey(
  demoKey: string | null | undefined,
): DemoSourceSeed | null {
  if (!demoKey) return null;
  const source = demoSourceDefinitions.find(
    (candidate) => candidate.id === demoKey,
  );
  return source ? toDemoSourceSeed(source) : null;
}

function getSourceSeedByDocumentId(
  documentId: string | null | undefined,
): DemoSourceSeed | null {
  if (!documentId) return null;
  const source = demoSourceDefinitions.find(
    (candidate) => candidate.documentId === documentId,
  );
  return source ? toDemoSourceSeed(source) : null;
}

function getChunkCountForDocumentId(
  documentId: string | null | undefined,
): number | undefined {
  return getSourceSeedByDocumentId(documentId)?.chunkCount;
}

async function loadChunksForSource(
  sourceId: string,
): Promise<ParsedChunkView[] | null> {
  const source = demoSourceDefinitions.find(
    (candidate) => candidate.id === sourceId,
  );
  return source ? loadChunksForDefinition(source) : null;
}

async function loadChunksForDocumentId(
  documentId: string | null | undefined,
): Promise<ParsedChunkView[] | null> {
  if (!documentId) return null;
  const source = demoSourceDefinitions.find(
    (candidate) => candidate.documentId === documentId,
  );
  return source ? loadChunksForDefinition(source) : null;
}

async function loadChunksForDefinition(
  source: DemoSourceDefinition,
): Promise<ParsedChunkView[]> {
  const filePath = path.join(
    demoAssetsDirectoryPath,
    source.assetDirectory,
    "chunks.json",
  );
  const body = await readFile(filePath, "utf8");
  const rawChunks = parseRawChunks(JSON.parse(body) as unknown);

  return parsedChunkNormalization.resolveConnectionTargets(
    rawChunks.map((chunk) => toParsedChunkView(source, chunk)),
  );
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
  const filePathCandidates = [
    metadata["file_path"],
    metadata["filePath"],
    chunk.path,
  ] as const;
  const filePath = getFirstString(filePathCandidates);
  const assetUrl = isChunkAsset(chunk.type) && filePath
    ? parsedChunkNormalization.buildDemoAssetURL({
        assetDirectory: source.assetDirectory,
        filePath,
      })
    : undefined;

  return parsedChunkNormalization.createParsedChunkView({
    chunkId: `${source.id}:${chunk.chunk_id}`,
    parserChunkId: chunk.chunk_id,
    documentId: source.documentId,
    sectionPath: getString(chunk.path) ?? null,
    chunkType: chunk.type,
    content: chunk.content,
    metadata,
    filePathCandidates,
    assetUrl,
    sourceTitle: source.title,
  });
}

function toDemoSourceSeed(source: DemoSourceDefinition): DemoSourceSeed {
  return {
    demoKey: source.id,
    documentId: source.documentId,
    title: source.title,
    mimeType: source.mimeType,
    originalFileUrl: parsedChunkNormalization.buildDemoAssetURL({
      assetDirectory: source.assetDirectory,
      filePath: source.originalFilePath,
    }),
    originalFileSystemPath: path.join(
      demoAssetsDirectoryPath,
      source.assetDirectory,
      source.originalFilePath,
    ),
    originalSizeBytes: source.originalSizeBytes,
    chunkCount: source.chunkCount,
    chatThreadTitle: source.chatThreadTitle,
  };
}

function isChunkAsset(value: string): boolean {
  return value === "image" || value === "table";
}

function getFirstString(values: readonly unknown[]): string | undefined {
  return values.reduce<string | undefined>(
    (selected, value) => selected ?? getString(value),
    undefined,
  );
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

export const demoData = {
  getChunkCountForDocumentId,
  getSourceSeedByDemoKey,
  getSourceSeedByDocumentId,
  listSourceSeeds,
  listSources,
  loadChunksForDocumentId,
  loadChunksForSource,
} as const;
