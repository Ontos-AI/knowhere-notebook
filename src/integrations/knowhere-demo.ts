import "server-only"

import { Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform"

export type DemoCitation = {
  readonly demoSourceId: string
  readonly canonicalDocumentId: string
  readonly namespace?: string
  readonly jobResultId?: string
  readonly canonicalChunkId: string
  readonly chunkId: string
  readonly chunkType: string
  readonly content: string
  readonly description?: string
  readonly pageCitationPageNumber?: number
  readonly pageCitationAssetUrl?: string
  readonly pageNums?: readonly number[]
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
  readonly namespace?: string
  readonly jobResultId?: string
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
  readonly officialLibrary?: OfficialLibrarySource
  readonly examples: readonly DemoExample[]
}

export type DemoCatalog = {
  readonly sources: readonly DemoSource[]
  readonly officialLibrary: OfficialLibraryCatalog
  readonly importStatuses?: readonly { readonly demoSourceId: string; readonly status: string }[]
}

export type OfficialLibraryCategory = {
  readonly categoryId: string
  readonly label: string
  readonly description: string
}

export type OfficialLibrarySource = {
  readonly librarySourceId: string
  readonly categoryId: string
  readonly title: string
  readonly sourceUrl: string
  readonly mimeType: string
  readonly status: "ready" | "planned"
  readonly demoSourceId?: string
  readonly canonicalDocumentId?: string
  readonly sizeBytes?: number
  readonly chunkCount?: number
}

export type OfficialLibraryCatalog = {
  readonly categories: readonly OfficialLibraryCategory[]
  readonly sources: readonly OfficialLibrarySource[]
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
  readonly namespace?: string
  readonly jobResultId?: string
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

type DemoSourceResponse = {
  readonly demo_source_id?: unknown
  readonly canonical_document_id?: unknown
  readonly job_result_id?: unknown
  readonly namespace?: unknown
  readonly title?: unknown
  readonly mime_type?: unknown
  readonly size_bytes?: unknown
  readonly status?: unknown
  readonly chunk_count?: unknown
  readonly original_file?: DemoOriginalFileResponse
  readonly official_library?: OfficialLibrarySourceResponse
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
  readonly id?: unknown
  readonly demo_chunk_id?: unknown
  readonly document_id?: unknown
  readonly demo_source_id?: unknown
  readonly canonical_document_id?: unknown
  readonly canonical_chunk_id?: unknown
  readonly chunk_id?: unknown
  readonly chunk_type?: unknown
  readonly type?: unknown
  readonly content?: unknown
  readonly description?: unknown
  readonly section_path?: unknown
  readonly page_number?: unknown
  readonly page_citation_page_number?: unknown
  readonly page_citation_asset_url?: unknown
  readonly page_nums?: unknown
  readonly job_result_id?: unknown
  readonly namespace?: unknown
  readonly source?: {
    readonly document_id?: unknown
    readonly source_file_name?: unknown
    readonly section_path?: unknown
  }
}

type DemoChunkPageResponse = {
  readonly document_id?: unknown
  readonly demo_source_id?: unknown
  readonly canonical_document_id?: unknown
  readonly job_result_id?: unknown
  readonly namespace?: unknown
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

type OfficialLibraryCatalogResponse = {
  readonly categories?: readonly OfficialLibraryCategoryResponse[]
  readonly sources?: readonly OfficialLibrarySourceResponse[]
}

type OfficialLibraryCategoryResponse = {
  readonly category_id?: unknown
  readonly label?: unknown
  readonly description?: unknown
}

type OfficialLibrarySourceResponse = {
  readonly library_source_id?: unknown
  readonly category_id?: unknown
  readonly title?: unknown
  readonly source_url?: unknown
  readonly mime_type?: unknown
  readonly status?: unknown
  readonly demo_source_id?: unknown
  readonly canonical_document_id?: unknown
  readonly size_bytes?: unknown
  readonly chunk_count?: unknown
}

const DEFAULT_KNOWHERE_BASE_URL = "https://api.knowhereto.ai"

const emptyCatalog: DemoCatalog = {
  sources: [],
  officialLibrary: { categories: [], sources: [] },
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const readJsonEffect = Effect.fn("knowhereDemo.readJson")(function* (path: string) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get(resolveApiURL(path)))
  if (response.status < 200 || response.status >= 300) {
    const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
    return yield* Effect.fail(new KnowhereDemoApiError(response.status, body))
  }
  return yield* response.json
})

const DemoResponseRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const DemoCatalogResponseSchema = Schema.Struct({
  import_status: Schema.optional(Schema.Array(Schema.Struct({ demo_source_id: Schema.String, status: Schema.String }))),
  sources: Schema.optional(Schema.Array(DemoResponseRecord)),
  official_library: Schema.optional(Schema.Struct({
    categories: Schema.optional(Schema.Array(DemoResponseRecord)),
    sources: Schema.optional(Schema.Array(DemoResponseRecord)),
  })),
})
const DemoChunkPageResponseSchema = Schema.Struct({
  demo_source_id: Schema.optional(Schema.Unknown),
  document_id: Schema.optional(Schema.Unknown),
  canonical_document_id: Schema.optional(Schema.Unknown),
  namespace: Schema.optional(Schema.Unknown),
  job_result_id: Schema.optional(Schema.Unknown),
  title: Schema.optional(Schema.Unknown),
  mime_type: Schema.optional(Schema.Unknown),
  chunks: Schema.optional(Schema.Array(DemoResponseRecord)),
  pagination: Schema.optional(DemoResponseRecord),
})

const fetchCatalogEffect = Effect.fn("knowhereDemo.fetchCatalog")(function* () {
  const response = yield* readJsonEffect("/api/v1/demo/catalog")
  const body = yield* Schema.decodeUnknown(DemoCatalogResponseSchema)(response)
  return {
    sources: (body.sources ?? []).map(decodeDemoSource),
    officialLibrary: toOfficialLibraryCatalog(body.official_library),
    ...(body.import_status ? { importStatuses: body.import_status.map((entry) => ({ demoSourceId: entry.demo_source_id, status: entry.status })) } : {}),
  }
})

const fetchChunkPageEffect = Effect.fn("knowhereDemo.fetchChunkPage")(
  function* (input: {
    readonly demoSourceId: string
    readonly page: number
    readonly pageSize: number
    readonly jobResultId?: string
  }) {
    const params: URLSearchParams = new URLSearchParams({ page: String(input.page), page_size: String(input.pageSize) })
    if (input.jobResultId) params.set("job_result_id", input.jobResultId)
    const response = yield* readJsonEffect(`/api/v1/demo/sources/${encodeURIComponent(input.demoSourceId)}/chunks?${params.toString()}`)
    const body = yield* Schema.decodeUnknown(DemoChunkPageResponseSchema)(response)
    const source = yield* readDemoSourceFallback(input.demoSourceId, body)
    return toDemoChunkPage(body, source)
  },
)

function readDemoSourceFallback(
  demoSourceId: string,
  response: DemoChunkPageResponse,
): Effect.Effect<{
  readonly demoSourceId: string
  readonly canonicalDocumentId?: string
  readonly title?: string
  readonly mimeType?: string
}, never, HttpClient.HttpClient> {
  const hasCompleteMetadata =
    optionalString(response.demo_source_id) !== undefined &&
    (optionalString(response.canonical_document_id) ??
      optionalString(response.document_id)) !== undefined &&
    optionalString(response.title) !== undefined &&
    optionalString(response.mime_type) !== undefined
  if (hasCompleteMetadata) {
    return Effect.succeed({ demoSourceId })
  }

  return fetchCatalogEffect().pipe(
    Effect.map((catalog) => {
      const source = catalog.sources.find(
        (candidate) => candidate.demoSourceId === demoSourceId,
      )
      return {
        demoSourceId,
        ...(source
          ? {
              canonicalDocumentId: source.canonicalDocumentId,
              title: source.title,
              mimeType: source.mimeType,
            }
          : {}),
      }
    }),
    Effect.catchAll(() => Effect.succeed({ demoSourceId })),
  )
}

// ---------------------------------------------------------------------------
// Async wrappers (backward-compatible)
// ---------------------------------------------------------------------------

async function fetchCatalog(): Promise<DemoCatalog> {
  return Effect.runPromise(fetchCatalogEffect().pipe(Effect.provide(FetchHttpClient.layer), Effect.provideService(FetchHttpClient.RequestInit, { cache: "no-store" })))
}

async function fetchOptionalCatalog(
  fetcher?: () => Promise<DemoCatalog>,
): Promise<DemoCatalog> {
  return Effect.runPromise(
    Effect.tryPromise(() => (fetcher ?? fetchCatalog)()).pipe(
      Effect.orElseSucceed(() => emptyCatalog),
    ),
  )
}

async function fetchChunkPage(input: {
  readonly demoSourceId: string
  readonly page: number
  readonly pageSize: number
  readonly jobResultId?: string
}): Promise<DemoChunkPage> {
  return Effect.runPromise(fetchChunkPageEffect(input).pipe(Effect.provide(FetchHttpClient.layer), Effect.provideService(FetchHttpClient.RequestInit, { cache: "no-store" })))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const knowhereDemoApi = {
  fetchCatalog,
  fetchOptionalCatalog,
  fetchChunkPage,
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

function decodeDemoSource(source: Readonly<Record<string, unknown>>): DemoSource {
  const decoded = Schema.decodeUnknownSync(Schema.Struct({
    demo_source_id: Schema.Unknown, canonical_document_id: Schema.Unknown,
    namespace: Schema.Literal("__knowhere_demo__"), job_result_id: Schema.String.pipe(Schema.minLength(1)),
    title: Schema.Unknown, mime_type: Schema.Unknown, size_bytes: Schema.Unknown,
    chunk_count: Schema.Unknown, status: Schema.optional(Schema.Unknown),
    original_file: Schema.optional(DemoResponseRecord),
    official_library: Schema.optional(DemoResponseRecord),
  }))(source)
  return toDemoSource({ ...decoded, examples: decodeDemoExamples(source.examples) })
}

function decodeDemoExamples(value: unknown): readonly DemoExampleResponse[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((example) => ({
    ...example,
    citations: Array.isArray(example.citations) ? example.citations.filter(isRecord).map((citation) => ({
      ...citation,
      source: isRecord(citation.source) ? citation.source : undefined,
    })) : [],
  }))
}

function toDemoSource(source: DemoSourceResponse): DemoSource {
  const demoSourceId = requireString(source.demo_source_id)
  const title = requireString(source.title)
  const officialLibrary = source.official_library
    ? toOfficialLibrarySource(source.official_library)
    : undefined
  return {
    demoSourceId,
    canonicalDocumentId: requireString(source.canonical_document_id),
    namespace: optionalString(source.namespace) ?? "__knowhere_demo__",
    ...(optionalString(source.job_result_id) ? { jobResultId: optionalString(source.job_result_id) } : {}),
    title,
    mimeType: requireString(source.mime_type),
    sizeBytes: requireNumber(source.size_bytes),
    status: "ready",
    chunkCount: requireNumber(source.chunk_count),
    originalFile: toOriginalFile(source.original_file),
    ...(officialLibrary ? { officialLibrary } : {}),
    examples: (source.examples ?? []).map((example) =>
      toDemoExample(example, title, demoSourceId),
    ),
  }
}

function toDemoExample(
  example: DemoExampleResponse,
  sourceTitle: string,
  demoSourceId: string,
): DemoExample {
  return {
    id: requireString(example.id),
    question: requireString(example.question),
    answer: requireString(example.answer),
    citations: (example.citations ?? []).map((citation) =>
      toDemoCitation(citation, sourceTitle, demoSourceId),
    ),
  }
}

function toDemoCitation(
  citation: DemoCitationResponse,
  sourceTitle: string,
  demoSourceId: string,
): DemoCitation {
  const source = citation.source ?? {}
  const description = optionalString(citation.description)
  const canonicalDocumentId = requireString(
    citation.canonical_document_id ?? citation.document_id,
  )
  const pageNums = toPositiveIntegers(
    citation.page_nums,
    citation.page_number,
  )
  const pageCitationPageNumber =
    optionalPositiveInteger(citation.page_citation_page_number) ??
    optionalPositiveInteger(citation.page_number) ??
    pageNums[0]
  const pageCitationAssetUrl = toDemoAssetUrl(
    optionalString(citation.demo_source_id) ?? demoSourceId,
    optionalString(citation.page_citation_asset_url),
    optionalString(citation.job_result_id),
  )
  return {
    demoSourceId: optionalString(citation.demo_source_id) ?? demoSourceId,
    canonicalDocumentId,
    namespace: optionalString(citation.namespace) ?? "__knowhere_demo__",
    ...(optionalString(citation.job_result_id) ? { jobResultId: optionalString(citation.job_result_id) } : {}),
    canonicalChunkId: requireString(
      citation.canonical_chunk_id ?? citation.id ?? citation.demo_chunk_id,
    ),
    chunkId: requireString(citation.chunk_id),
    chunkType: optionalString(citation.chunk_type) ??
      optionalString(citation.type) ??
      "text",
    content: requireString(citation.content),
    ...(description ? { description } : {}),
    ...(pageCitationPageNumber !== undefined
      ? { pageCitationPageNumber }
      : {}),
    ...(pageCitationAssetUrl ? { pageCitationAssetUrl } : {}),
    ...(pageNums.length > 0 ? { pageNums } : {}),
    source: {
      documentId: requireString(
        source.document_id ?? citation.document_id ?? canonicalDocumentId,
      ),
      sourceFileName: optionalString(source.source_file_name) ?? sourceTitle,
      sectionPath: requireString(source.section_path ?? citation.section_path),
    },
  }
}

function toDemoChunkPage(
  response: DemoChunkPageResponse,
  fallback: {
    readonly demoSourceId: string
    readonly canonicalDocumentId?: string
    readonly title?: string
    readonly mimeType?: string
  },
): DemoChunkPage {
  const pagination = response.pagination ?? {}
  return {
    demoSourceId: requireString(response.demo_source_id ?? fallback.demoSourceId),
    canonicalDocumentId: requireString(
      response.canonical_document_id ??
        response.document_id ??
        fallback.canonicalDocumentId,
    ),
    namespace: optionalString(response.namespace) ?? "__knowhere_demo__",
    ...(optionalString(response.job_result_id) ? { jobResultId: optionalString(response.job_result_id) } : {}),
    title: requireString(response.title ?? fallback.title),
    mimeType: requireString(response.mime_type ?? fallback.mimeType),
    chunks: (response.chunks ?? []).map((chunk) =>
      toDemoChunk(
        requireString(response.demo_source_id ?? fallback.demoSourceId),
        chunk,
        optionalString(response.job_result_id),
      ),
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
  jobResultId?: string,
): DemoChunk {
  const metadata = rewriteDemoPageAssetMetadata(
    demoSourceId,
    toRecord(chunk.metadata),
    jobResultId,
  )
  return {
    id: requireString(chunk.id),
    chunkId: requireString(chunk.chunk_id),
    chunkType: requireString(chunk.chunk_type),
    content: requireContentString(chunk.content),
    sectionPath: optionalString(chunk.section_path) ?? null,
    sourceChunkPath: optionalString(chunk.source_chunk_path) ?? null,
    filePath: optionalString(chunk.file_path) ?? null,
    sortOrder: requireNumber(chunk.sort_order),
    metadata,
    assetUrl:
      toDemoArtifactUrl(demoSourceId, optionalString(chunk.file_path), jobResultId) ??
      toDemoAssetUrl(demoSourceId, optionalString(chunk.asset_url), jobResultId) ??
      firstDemoPageAssetUrl(metadata),
  }
}

function toOfficialLibraryCatalog(
  input: OfficialLibraryCatalogResponse | undefined,
): OfficialLibraryCatalog {
  const officialLibrary = input ?? {}
  return {
    categories: (officialLibrary.categories ?? []).map(
      toOfficialLibraryCategory,
    ),
    sources: (officialLibrary.sources ?? []).map(toOfficialLibrarySource),
  }
}

function toOfficialLibraryCategory(
  category: OfficialLibraryCategoryResponse,
): OfficialLibraryCategory {
  return {
    categoryId: requireString(category.category_id),
    label: requireString(category.label),
    description: requireString(category.description),
  }
}

function toOfficialLibrarySource(
  source: OfficialLibrarySourceResponse,
): OfficialLibrarySource {
  const status = requireString(source.status)
  const demoSourceId = optionalString(source.demo_source_id)
  const canonicalDocumentId = optionalString(source.canonical_document_id)
  const sizeBytes = optionalNumber(source.size_bytes)
  const chunkCount = optionalNumber(source.chunk_count)
  return {
    librarySourceId: requireString(source.library_source_id),
    categoryId: requireString(source.category_id),
    title: requireString(source.title),
    sourceUrl: requireString(source.source_url),
    mimeType: requireString(source.mime_type),
    status: status === "ready" ? "ready" : "planned",
    ...(demoSourceId ? { demoSourceId } : {}),
    ...(canonicalDocumentId ? { canonicalDocumentId } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(chunkCount !== undefined ? { chunkCount } : {}),
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

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function toRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {}
  }
  return Schema.decodeUnknownSync(DemoResponseRecord)(value)
}

function rewriteDemoPageAssetMetadata(
  demoSourceId: string,
  metadata: Readonly<Record<string, unknown>>,
  jobResultId?: string,
): Readonly<Record<string, unknown>> {
  const rawAssets = metadata.pageAssets ?? metadata.page_assets
  if (!Array.isArray(rawAssets)) return metadata

  const pageAssets = rawAssets.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return []
    }
    const asset = toRecord(item)
    const pageNum =
      optionalPositiveNumber(asset.pageNum) ??
      optionalPositiveNumber(asset.pageNumber) ??
      optionalPositiveNumber(asset.page_num)
    const contentType =
      optionalString(asset.contentType) ?? optionalString(asset.content_type)
    const artifactRef = optionalString(asset.artifact_ref)
    const assetUrl: string | null = toDemoArtifactUrl(demoSourceId, artifactRef, jobResultId) ?? toDemoAssetUrl(
      demoSourceId,
      optionalString(asset.assetUrl) ?? optionalString(asset.asset_url),
      jobResultId,
    )
    if (!pageNum || !contentType || !assetUrl) return []

    return [
      {
        pageNum,
        assetUrl,
        contentType,
        ...(optionalPositiveNumber(asset.width) !== undefined
          ? { width: optionalPositiveNumber(asset.width) }
          : {}),
        ...(optionalPositiveNumber(asset.height) !== undefined
          ? { height: optionalPositiveNumber(asset.height) }
          : {}),
      },
    ]
  })

  const next: Record<string, unknown> = { ...metadata, pageAssets }
  delete next.page_assets
  return next
}

function firstDemoPageAssetUrl(
  metadata: Readonly<Record<string, unknown>>,
): string | null {
  const pageAssets = metadata.pageAssets
  if (!Array.isArray(pageAssets) || pageAssets.length === 0) return null
  const first = pageAssets[0]
  if (typeof first !== "object" || first === null) return null
  return optionalString(toRecord(first).assetUrl) ?? null
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined
}

function toPositiveIntegers(
  value: unknown,
  scalarValue?: unknown,
): readonly number[] {
  const values = Array.isArray(value) ? value : []
  const pages = values.flatMap((item) => {
    const page = optionalPositiveInteger(item)
    return page === undefined ? [] : [page]
  })
  const scalarPage = optionalPositiveInteger(scalarValue)
  return scalarPage !== undefined && !pages.includes(scalarPage)
    ? [...pages, scalarPage]
    : pages
}

function toDemoAssetUrl(
  demoSourceId: string,
  assetUrl: string | undefined,
  jobResultId?: string,
): string | null {
  if (!assetUrl) return null
  const remoteUrl: URL = new URL(assetUrl, "https://notebook.invalid")
  const marker: string = "/assets/"
  const markerIndex: number = remoteUrl.pathname.indexOf(marker)
  if (markerIndex === -1) return null
  const assetPath: string = remoteUrl.pathname.slice(markerIndex + marker.length)
  const parameters: URLSearchParams = new URLSearchParams()
  const revision: string | null | undefined = jobResultId ?? remoteUrl.searchParams.get("job_result_id")
  if (revision) parameters.set("job_result_id", revision)
  const query: string = parameters.size > 0 ? `?${parameters.toString()}` : ""
  return `/api/demo-sources/${encodeURIComponent(demoSourceId)}/assets/${assetPath}${query}`
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toDemoArtifactUrl(demoSourceId: string, artifactRef: string | undefined, jobResultId: string | undefined): string | null {
  if (!artifactRef || artifactRef.startsWith("/") || artifactRef.includes("\\")) return null
  const segments: readonly string[] = artifactRef.split("/")
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return null
  return toDemoAssetUrl(demoSourceId, `/api/v1/demo/sources/${encodeURIComponent(demoSourceId)}/assets/${segments.map(encodeURIComponent).join("/")}`, jobResultId)
}
