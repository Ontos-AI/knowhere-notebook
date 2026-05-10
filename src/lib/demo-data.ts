import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChunkType,
  ParsedChunkConnection,
  ParsedChunkView,
  SourceView,
} from "./types";

type DemoSourceDefinition = {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly mimeType: string;
  readonly originalFilePath: string;
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
    mimeType: "application/pdf",
    originalFilePath: "original.pdf",
    assetDirectory: "tsla-q4-2025",
    chunkCount: 71,
  },
  {
    id: "demo-epstein-flight-logs",
    documentId: "demo-doc-epstein-flight-logs",
    title: "EPSTEIN FLIGHT LOGS UNREDACTED.pdf",
    mimeType: "application/pdf",
    originalFilePath: "original.pdf",
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
    mimeType: source.mimeType,
    status: "ready",
    documentId: source.documentId,
    chunkCount: source.chunkCount,
    originalFile: {
      url: buildDemoAssetURL(source.assetDirectory, source.originalFilePath),
      mimeType: source.mimeType,
      canDownload: false,
    },
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

  return resolveDemoConnectionTargets(
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
  const filePath =
    getStringMetadata(metadata, "file_path") ?? getString(chunk.path);
  const assetUrl =
    filePath && (chunk.type === "image" || chunk.type === "table")
      ? buildDemoAssetURL(source.assetDirectory, filePath)
      : undefined;

  return {
    chunkId: `${source.id}:${chunk.chunk_id}`,
    parserChunkId: chunk.chunk_id,
    documentId: source.documentId,
    sectionPath: getString(chunk.path) ?? null,
    type: toChunkType(chunk.type),
    content: getString(chunk.content) ?? "",
    filePath,
    assetUrl,
    summary: getStringMetadata(metadata, "summary"),
    keywords: getStringArrayMetadata(metadata, "keywords"),
    pageNums: getNumberArrayMetadata(metadata, "page_nums"),
    connections: getChunkConnections(metadata),
    sourceTitle: source.title,
  };
}

function buildDemoAssetURL(assetDirectory: string, filePath: string): string {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/demo-sources/${encodeURIComponent(assetDirectory)}/${encodedPath}`;
}

function resolveDemoConnectionTargets(
  chunks: ParsedChunkView[],
): ParsedChunkView[] {
  const chunkIdsByParserChunkId = new Map(
    chunks
      .filter((chunk) => chunk.parserChunkId)
      .map((chunk) => [chunk.parserChunkId!, chunk.chunkId]),
  );

  return chunks.map((chunk) => {
    if (!chunk.connections || chunk.connections.length === 0) return chunk;

    return {
      ...chunk,
      connections: chunk.connections.map((connection) => ({
        ...connection,
        targetChunkId:
          chunkIdsByParserChunkId.get(connection.targetParserChunkId) ??
          connection.targetChunkId,
      })),
    };
  });
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

function getChunkConnections(
  metadata: Readonly<Record<string, unknown>>,
): ParsedChunkConnection[] | undefined {
  const value = metadata["connect_to"] ?? metadata["connectTo"];
  if (!Array.isArray(value)) return undefined;

  const connections = value.flatMap((item): ParsedChunkConnection[] => {
    if (!isRecord(item)) return [];
    const targetParserChunkId = getString(item["target"]);
    if (!targetParserChunkId) return [];

    return [
      {
        targetParserChunkId,
        relation: getString(item["relation"]) ?? "related",
        ref: getString(item["ref"]),
        position: getConnectionPosition(item["position"]),
      },
    ];
  });

  return connections.length > 0 ? connections : undefined;
}

function getConnectionPosition(
  value: unknown,
): ParsedChunkConnection["position"] | undefined {
  if (!isRecord(value)) return undefined;
  const start = value["start"];
  const end = value["end"];
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return undefined;
  }
  return { start, end };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

export const demoData = {
  listSources,
  loadChunksForSource,
} as const;
