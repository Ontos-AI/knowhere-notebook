import "server-only"

import { Effect, Schema } from "effect"
import { cacheLife, cacheTag } from "next/cache"

export type DemoCitation = {
  readonly demoSourceId: string
  readonly canonicalDocumentId: string
  readonly canonicalChunkId: string
  readonly chunkId: string
  readonly chunkType: string
  readonly content: string
  readonly description?: string
  readonly source: {
    readonly documentId: string
    readonly sourceFileName: string
    readonly sectionPath: string
  }
}

export type DemoExample = {
  readonly id: string
  readonly question: string
  readonly answer: string
  readonly citations: readonly DemoCitation[]
}

export type DemoSource = {
  readonly demoSourceId: string
  readonly canonicalDocumentId: string
  readonly title: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly status: "ready"
  readonly chunkCount: number
  readonly originalFile: {
    readonly url: string
    readonly mimeType: string
    readonly sizeBytes: number
    readonly canDownload: boolean
  }
  readonly examples: readonly DemoExample[]
}

export type DemoCatalog = {
  readonly sources: readonly DemoSource[]
}

export type DemoChunk = {
  readonly id: string
  readonly chunkId: string
  readonly chunkType: string
  readonly content: string
  readonly sectionPath?: string | null
  readonly sourceChunkPath?: string | null
  readonly filePath?: string | null
  readonly sortOrder: number
  readonly metadata: Readonly<Record<string, unknown>>
  readonly assetUrl?: string | null
}

export type DemoChunkPage = {
  readonly demoSourceId: string
  readonly canonicalDocumentId: string
  readonly title: string
  readonly mimeType: string
  readonly chunks: readonly DemoChunk[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly total: number
    readonly totalPages: number
  }
}

export type MaterializedDemoSource = {
  readonly demoSourceId: string
  readonly documentId: string
  readonly status: "created" | "existing"
  readonly title: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly chunkCount: number
  readonly originalFile: {
    readonly url: string
    readonly mimeType: string
    readonly sizeBytes: number
    readonly canDownload: boolean
  }
}

type DemoCatalogResponse = {
  readonly sources?: readonly DemoSourceResponse[]
}

type DemoSourceResponse = {
  readonly demo_source_id?: unknown
  readonly canonical_document_id?: unknown
  readonly title?: unknown
  readonly mime_type?: unknown
  readonly size_bytes?: unknown
  readonly status?: unknown
  readonly chunk_count?: unknown
  readonly original_file?: DemoOriginalFileResponse
  readonly examples?: readonly DemoExampleResponse[]
}

type DemoOriginalFileResponse = {
  readonly url?: unknown
  readonly mime_type?: unknown
  readonly size_bytes?: unknown
  readonly can_download?: unknown
}

type DemoExampleResponse = {
  readonly id?: unknown
  readonly question?: unknown
  readonly answer?: unknown
  readonly citations?: readonly DemoCitationResponse[]
}

type DemoCitationResponse = {
  readonly demo_source_id?: unknown
  readonly canonical_document_id?: unknown
  readonly canonical_chunk_id?: unknown
  readonly chunk_id?: unknown
  readonly chunk_type?: unknown
  readonly content?: unknown
  readonly description?: unknown
  readonly source?: {
    readonly document_id?: unknown
    readonly source_file_name?: unknown
    readonly section_path?: unknown
  }
}

type DemoChunkPageResponse = {
  readonly demo_source_id?: unknown
  readonly canonical_document_id?: unknown
  readonly title?: unknown
  readonly mime_type?: unknown
  readonly chunks?: readonly DemoChunkResponse[]
  readonly pagination?: {
    readonly page?: unknown
    readonly page_size?: unknown
    readonly total?: unknown
    readonly total_pages?: unknown
  }
}

type DemoChunkResponse = {
  readonly id?: unknown
  readonly chunk_id?: unknown
  readonly chunk_type?: unknown
  readonly content?: unknown
  readonly section_path?: unknown
  readonly source_chunk_path?: unknown
  readonly file_path?: unknown
  readonly sort_order?: unknown
  readonly metadata?: unknown
  readonly asset_url?: unknown
}

type MaterializeResponse = {
  readonly sources?: readonly MaterializedDemoSourceResponse[]
}

type MaterializedDemoSourceResponse = {
  readonly demo_source_id?: unknown
  readonly document_id?: unknown
  readonly status?: unknown
  readonly title?: unknown
  readonly mime_type?: unknown
  readonly size_bytes?: unknown
  readonly chunk_count?: unknown
  readonly original_file?: DemoOriginalFileResponse
}

const DEFAULT_KNOWHERE_BASE_URL = "https://api.knowhereto.ai"

const emptyCatalog: DemoCatalog = { sources: [] }

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const fetchCatalogEffect = Effect.fn("knowhereDemo.fetchCatalog")(function* () {
  const response = yield* Effect.tryPromise(() =>
    fetch(resolveApiURL("/api/v1/demo/catalog")),
  )
  yield* assertOkEffect(response)

  const body = (yield* Effect.tryPromise(() =>
    response.json(),
  )) as DemoCatalogResponse
  return {
    sources: (body.sources ?? []).map(toDemoSource),
  }
})

const fetchChunkPageEffect = Effect.fn("knowhereDemo.fetchChunkPage")(
  function* (input: {
    readonly demoSourceId: string
    readonly page: number
    readonly pageSize: number
  }) {
    const params = new URLSearchParams({
      page: String(input.page),
      page_size: String(input.pageSize),
    })
    const response = yield* Effect.tryPromise(() =>
      fetch(
        resolveApiURL(
          `/api/v1/demo/sources/${encodeURIComponent(input.demoSourceId)}/chunks?${params.toString()}`,
        ),
      ),
    )
    yield* assertOkEffect(response)

    return toDemoChunkPage(
      (yield* Effect.tryPromise(() =>
        response.json(),
      )) as DemoChunkPageResponse,
    )
  },
)

const materializeSourcesEffect = Effect.fn("knowhereDemo.materializeSources")(
  function* (input: {
    readonly apiKey: string
    readonly namespace: string
    readonly demoSourceIds: readonly string[]
  }) {
    const requestBody = yield* Schema.encode(MaterializeSourcesRequestJson)({
      namespace: input.namespace,
      demo_source_ids: input.demoSourceIds,
    })
    const response = yield* Effect.tryPromise(() =>
      fetch(resolveApiURL("/api/v1/demo/materializations"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: requestBody,
      }),
    )
    yield* assertOkEffect(response)

    const body = (yield* Effect.tryPromise(() =>
      response.json(),
    )) as MaterializeResponse
    return (body.sources ?? []).map(toMaterializedDemoSource)
  },
)

const MaterializeSourcesRequestJson = Schema.parseJson(
  Schema.Struct({
    namespace: Schema.String,
    demo_source_ids: Schema.Array(Schema.String),
  }),
)

const fetchOptionalCatalogEffect = (
  fetcher?: () => Effect.Effect<DemoCatalog, unknown>,
) =>
  (fetcher ?? fetchCatalogEffect)().pipe(
    Effect.catchAll(() => Effect.succeed(emptyCatalog)),
  )

// ---------------------------------------------------------------------------
// Async wrappers (backward-compatible)
// ---------------------------------------------------------------------------

async function fetchCatalog(): Promise<DemoCatalog> {
  "use cache"
  cacheLife("max")
  cacheTag("demo-catalog")

  return Effect.runPromise(fetchCatalogEffect())
}

async function fetchOptionalCatalog(
  fetcher?: () => Promise<DemoCatalog>,
): Promise<DemoCatalog> {
  const effectFetcher = fetcher
    ? () =>
        Effect.tryPromise(() => fetcher()).pipe(
          Effect.catchAll(() => Effect.succeed(emptyCatalog)),
        )
    : undefined
  return Effect.runPromise(fetchOptionalCatalogEffect(effectFetcher))
}

async function fetchChunkPage(input: {
  readonly demoSourceId: string
  readonly page: number
  readonly pageSize: number
}): Promise<DemoChunkPage> {
  "use cache"
  cacheLife("max")
  cacheTag("demo-chunks", input.demoSourceId)

  return Effect.runPromise(fetchChunkPageEffect(input))
}

async function materializeSources(input: {
  readonly apiKey: string
  readonly namespace: string
  readonly demoSourceIds: readonly string[]
}): Promise<readonly MaterializedDemoSource[]> {
  return Effect.runPromise(materializeSourcesEffect(input))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const knowhereDemoApi = {
  fetchCatalog,
  fetchOptionalCatalog,
  fetchChunkPage,
  materializeSources,
  resolveApiURL,
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveApiURL(path: string): string {
  const baseURL = process.env.KNOWHERE_BASE_URL ?? DEFAULT_KNOWHERE_BASE_URL
  return new URL(path, baseURL).toString()
}

class KnowhereDemoApiError {
  readonly _tag = "KnowhereDemoApiError"
  constructor(
    readonly status: number,
    readonly body: string,
  ) {}
}

function assertOkEffect(
  response: Response,
): Effect.Effect<void, KnowhereDemoApiError> {
  if (response.ok) return Effect.void

  return Effect.gen(function* () {
    const body = yield* Effect.tryPromise(() =>
      response.text().catch(() => ""),
    ).pipe(Effect.orDie)
    return yield* Effect.fail(
      new KnowhereDemoApiError(response.status, body),
    )
  })
}

function toDemoSource(source: DemoSourceResponse): DemoSource {
  return {
    demoSourceId: requireString(source.demo_source_id),
    canonicalDocumentId: requireString(source.canonical_document_id),
    title: requireString(source.title),
    mimeType: requireString(source.mime_type),
    sizeBytes: requireNumber(source.size_bytes),
    status: "ready",
    chunkCount: requireNumber(source.chunk_count),
    originalFile: toOriginalFile(source.original_file),
    examples: (source.examples ?? []).map(toDemoExample),
  }
}

function toDemoExample(example: DemoExampleResponse): DemoExample {
  return {
    id: requireString(example.id),
    question: requireString(example.question),
    answer: requireString(example.answer),
    citations: (example.citations ?? []).map(toDemoCitation),
  }
}

function toDemoCitation(citation: DemoCitationResponse): DemoCitation {
  const source = citation.source ?? {}
  const description = optionalString(citation.description)
  return {
    demoSourceId: requireString(citation.demo_source_id),
    canonicalDocumentId: requireString(citation.canonical_document_id),
    canonicalChunkId: requireString(citation.canonical_chunk_id),
    chunkId: requireString(citation.chunk_id),
    chunkType: requireString(citation.chunk_type),
    content: requireString(citation.content),
    ...(description ? { description } : {}),
    source: {
      documentId: requireString(source.document_id),
      sourceFileName: requireString(source.source_file_name),
      sectionPath: requireString(source.section_path),
    },
  }
}

function toDemoChunkPage(response: DemoChunkPageResponse): DemoChunkPage {
  const pagination = response.pagination ?? {}
  return {
    demoSourceId: requireString(response.demo_source_id),
    canonicalDocumentId: requireString(response.canonical_document_id),
    title: requireString(response.title),
    mimeType: requireString(response.mime_type),
    chunks: (response.chunks ?? []).map((chunk) =>
      toDemoChunk(requireString(response.demo_source_id), chunk),
    ),
    pagination: {
      page: requireNumber(pagination.page),
      pageSize: requireNumber(pagination.page_size),
      total: requireNumber(pagination.total),
      totalPages: requireNumber(pagination.total_pages),
    },
  }
}

function toDemoChunk(
  demoSourceId: string,
  chunk: DemoChunkResponse,
): DemoChunk {
  return {
    id: requireString(chunk.id),
    chunkId: requireString(chunk.chunk_id),
    chunkType: requireString(chunk.chunk_type),
    content: requireContentString(chunk.content),
    sectionPath: optionalString(chunk.section_path) ?? null,
    sourceChunkPath: optionalString(chunk.source_chunk_path) ?? null,
    filePath: optionalString(chunk.file_path) ?? null,
    sortOrder: requireNumber(chunk.sort_order),
    metadata: toRecord(chunk.metadata),
    assetUrl: toDemoAssetUrl(demoSourceId, optionalString(chunk.asset_url)),
  }
}

function toMaterializedDemoSource(
  source: MaterializedDemoSourceResponse,
): MaterializedDemoSource {
  const status = requireString(source.status)
  return {
    demoSourceId: requireString(source.demo_source_id),
    documentId: requireString(source.document_id),
    status: status === "existing" ? "existing" : "created",
    title: requireString(source.title),
    mimeType: requireString(source.mime_type),
    sizeBytes: requireNumber(source.size_bytes),
    chunkCount: requireNumber(source.chunk_count),
    originalFile: toOriginalFile(source.original_file),
  }
}

function toOriginalFile(
  input: DemoOriginalFileResponse | undefined,
): DemoSource["originalFile"] {
  const originalFile = input ?? {}
  return {
    url: requireString(originalFile.url),
    mimeType: requireString(originalFile.mime_type),
    sizeBytes: requireNumber(originalFile.size_bytes),
    canDownload: originalFile.can_download === true,
  }
}

function requireString(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value
  }
  throw new Error("Expected non-empty string from Knowhere demo API.")
}

function requireContentString(value: unknown): string {
  if (typeof value === "string") return value
  throw new Error("Expected string content from Knowhere demo API.")
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
}

function requireNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  throw new Error("Expected finite number from Knowhere demo API.")
}

function toRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {}
  }
  return value as Readonly<Record<string, unknown>>
}

function toDemoAssetUrl(
  demoSourceId: string,
  assetUrl: string | undefined,
): string | null {
  if (!assetUrl) return null

  const assetPath = extractDemoAssetPath(assetUrl)
  if (!assetPath) return null

  return `/api/demo-sources/${encodeURIComponent(demoSourceId)}/assets/${assetPath}`
}

function extractDemoAssetPath(assetUrl: string): string | null {
  const marker = "/assets/"
  const markerIndex = assetUrl.indexOf(marker)
  if (markerIndex === -1) return null

  return assetUrl.slice(markerIndex + marker.length)
}
