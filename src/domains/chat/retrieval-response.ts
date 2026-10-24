import { Schema } from "effect"
import type { RetrievalQueryResponse, RetrievalResult, RetrievalReferencedChunk } from "@ontos-ai/knowhere-sdk"

const optionalString = Schema.optional(Schema.NullOr(Schema.String))
const metadataSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const retrievalSourceSchema = Schema.Struct({
  documentId: optionalString,
  sourceFileName: optionalString,
  sectionPath: optionalString,
  namespace: optionalString,
  jobResultId: optionalString,
})
const retrievalResultSchema = Schema.Struct({
  chunkId: Schema.optional(Schema.String),
  chunkRowId: Schema.optional(Schema.String),
  content: Schema.String,
  chunkType: Schema.String,
  contentSource: Schema.optional(Schema.String),
  score: Schema.NullOr(Schema.Number),
  assetUrl: Schema.optional(Schema.String),
  sourceChunkPath: optionalString,
  filePath: optionalString,
  metadata: Schema.optional(metadataSchema),
  namespace: optionalString,
  jobResultId: optionalString,
  source: retrievalSourceSchema,
})
const referencedChunkSchema = Schema.Struct({
  chunkId: Schema.String,
  chunkRowId: Schema.optional(Schema.String),
  documentId: Schema.String,
  // Older gateways can return ID-only provenance without chunk evidence.
  chunkType: Schema.optionalWith(Schema.String, { default: () => "" }),
  sectionPath: Schema.optionalWith(Schema.String, { default: () => "" }),
  contentSource: optionalString,
  sourceChunkPath: optionalString,
  filePath: optionalString,
  jobId: optionalString,
  namespace: optionalString,
  jobResultId: optionalString,
  assetUrl: optionalString,
  metadata: Schema.optional(metadataSchema),
})
const retrievalResponseSchema = Schema.Struct({
  namespace: Schema.String,
  query: Schema.String,
  routerUsed: Schema.String,
  answerText: Schema.NullOr(Schema.String),
  results: Schema.Array(retrievalResultSchema),
  referencedChunks: Schema.Array(referencedChunkSchema),
  evidenceText: optionalString,
  stopReason: optionalString,
  failureReason: optionalString,
  decisionTrace: Schema.optional(Schema.Array(metadataSchema)),
  evidence: Schema.optional(Schema.Array(Schema.Union(
    Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
    Schema.Struct({ type: Schema.Literal("image"), mediaType: Schema.String, data: Schema.String }),
  ))),
})

type RetrievalProvenance = {
  readonly namespace?: string | null
  readonly jobResultId?: string | null
}
type NotebookRetrievalResult = RetrievalResult & {
  readonly source: RetrievalResult["source"] & RetrievalProvenance
  readonly chunkRowId?: string
}
type NotebookRetrievalResponse = RetrievalQueryResponse & {
  results: NotebookRetrievalResult[]
  referencedChunks: (RetrievalReferencedChunk & RetrievalProvenance)[]
}

/** Validate SDK responses while retaining retrieval-time revision identity. */
export function decodeNotebookRetrievalResponse(value: unknown): NotebookRetrievalResponse {
  const response = Schema.decodeUnknownSync(retrievalResponseSchema)(value, { onExcessProperty: "preserve" })
  return {
    ...response,
    evidence: response.evidence?.map((part) => ({ ...part })),
    decisionTrace: response.decisionTrace?.map((trace) => ({ ...trace })),
    results: response.results.map((result): NotebookRetrievalResult => {
      const namespace: string = result.source.namespace ?? result.namespace ?? response.namespace
      const jobResultId: string | undefined = result.source.jobResultId ?? result.jobResultId ?? readMetadataString(result.metadata, "jobResultId")
      return { ...result, source: { ...result.source, namespace, ...(jobResultId ? { jobResultId } : {}) },
        metadata: { ...result.metadata, namespace, ...(jobResultId ? { jobResultId } : {}), ...(result.chunkRowId ? { chunkRowId: result.chunkRowId } : {}) } }
    }),
    referencedChunks: response.referencedChunks.map((chunk) => {
      const namespace: string = chunk.namespace ?? response.namespace
      const jobResultId: string | undefined = chunk.jobResultId ?? readMetadataString(chunk.metadata, "jobResultId")
      return { ...chunk, namespace, ...(jobResultId ? { jobResultId } : {}),
        metadata: { ...chunk.metadata, namespace, ...(jobResultId ? { jobResultId } : {}), ...(chunk.chunkRowId ? { chunkRowId: chunk.chunkRowId } : {}) } }
    }),
  }
}

function readMetadataString(metadata: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value: unknown = metadata?.[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}
