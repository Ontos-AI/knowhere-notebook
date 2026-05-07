import type { DocumentChunk, DocumentChunkType } from "@ontos-ai/knowhere-sdk";

import type { Source } from "./schema";
import type { ChunkType, ParsedChunkView } from "./types";

export type ChunkKnowhereClient = {
  documents: {
    listChunks(
      documentId: string,
      params: {
        page: number;
        pageSize: number;
        includeAssetUrls: boolean;
      },
    ): Promise<{ chunks: DocumentChunk[] }>;
  };
};

export async function loadChunksForSource(
  source: Source,
  client: ChunkKnowhereClient,
): Promise<ParsedChunkView[]> {
  if (source.status !== "ready" || !source.knowhereDocumentId) return [];

  const response = await client.documents.listChunks(source.knowhereDocumentId, {
    page: 1,
    pageSize: 100,
    includeAssetUrls: true,
  });
  return response.chunks.map((chunk) => toParsedChunkView(chunk, source.title));
}

export function toParsedChunkView(
  chunk: DocumentChunk,
  sourceTitle: string,
): ParsedChunkView {
  return {
    chunkId: chunk.id,
    type: toChunkType(chunk.chunkType),
    content: chunk.content ?? "",
    summary: getStringMetadata(chunk.metadata, "summary"),
    keywords: getStringArrayMetadata(chunk.metadata, "keywords"),
    pageNums: getNumberArrayMetadata(chunk.metadata, "pageNums"),
    sourceTitle,
  };
}

function toChunkType(chunkType: DocumentChunkType): ChunkType {
  if (chunkType === "image" || chunkType === "table") return chunkType;
  return "text";
}

function getStringMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function getStringArrayMetadata(
  metadata: Record<string, unknown>,
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
  metadata: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const value = metadata[key];
  if (!Array.isArray(value)) return undefined;

  const numbers = value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item),
  );
  return numbers.length > 0 ? numbers : undefined;
}
