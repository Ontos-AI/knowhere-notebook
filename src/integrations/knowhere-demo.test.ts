import { afterEach, describe, expect, it, vi } from "vitest"

const nextCacheMocks = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}))

vi.mock("next/cache", () => nextCacheMocks)

import { knowhereDemoApi } from "./knowhere-demo"

describe("knowhereDemoApi", () => {
  const originalBaseURL = process.env.KNOWHERE_BASE_URL
  const originalFetch = globalThis.fetch

  afterEach(() => {
    restoreEnv("KNOWHERE_BASE_URL", originalBaseURL)
    globalThis.fetch = originalFetch
    nextCacheMocks.cacheLife.mockClear()
    nextCacheMocks.cacheTag.mockClear()
  })

  it("uses the configured Knowhere base URL for demo requests", () => {
    process.env.KNOWHERE_BASE_URL = "https://api-staging.knowhereto.ai"

    const url = knowhereDemoApi.resolveApiURL("/api/v1/demo/catalog")

    expect(url).toBe("https://api-staging.knowhereto.ai/api/v1/demo/catalog")
  })

  it("falls back to production API instead of localhost", () => {
    delete process.env.KNOWHERE_BASE_URL

    const url = knowhereDemoApi.resolveApiURL("/api/v1/demo/catalog")

    expect(url).toBe("https://api.knowhereto.ai/api/v1/demo/catalog")
  })

  it("keeps catalog requests no-store without deploy-lifetime caching", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ sources: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    await expect(knowhereDemoApi.fetchCatalog()).resolves.toEqual({
      sources: [],
      officialLibrary: {
        categories: [],
        sources: [],
      },
    })

    expect(nextCacheMocks.cacheLife).not.toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ cache: "no-store" }))
  })

  it("preserves source and chunk revisions in upstream requests and stable media URLs", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      demo_source_id: "demo-report", canonical_document_id: "ddoc_report", namespace: "__knowhere_demo__", job_result_id: "revision-1", title: "report.pdf", mime_type: "application/pdf",
      chunks: [{ id: "dchk_row", chunk_id: "node-content", chunk_type: "page", content: "page", sort_order: 0, metadata: {}, asset_url: "https://api.example/api/v1/demo/sources/demo-report/assets/pages/1.png?job_result_id=revision-1&signature=expired" }],
      pagination: { page: 1, page_size: 50, total: 1, total_pages: 1 },
    }), { headers: { "content-type": "application/json" } }))
    const page = await knowhereDemoApi.fetchChunkPage({ demoSourceId: "demo-report", jobResultId: "revision-1", page: 1, pageSize: 50 })
    expect(page).toMatchObject({ namespace: "__knowhere_demo__", jobResultId: "revision-1" })
    expect(page.chunks[0]).toMatchObject({ id: "dchk_row", chunkId: "node-content", assetUrl: "/api/demo-sources/demo-report/assets/pages/1.png?job_result_id=revision-1" })
    expect(globalThis.fetch).toHaveBeenCalledWith(new URL("https://api.knowhereto.ai/api/v1/demo/sources/demo-report/chunks?page=1&page_size=50&job_result_id=revision-1"), expect.objectContaining({ cache: "no-store" }))
  })

  it("replaces signed storage media with manifest paths and pinned same-origin URLs", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      demo_source_id: "demo-report", canonical_document_id: "ddoc_report", job_result_id: "revision-1", title: "report.pdf", mime_type: "application/pdf",
      chunks: [{ id: "dchk_row", chunk_id: "node-content", chunk_type: "image", content: "image", sort_order: 0,
        file_path: "images/figure-1.png", asset_url: "https://s3.example/jobs/job/raw/images/figure-1.png?X-Amz-Signature=expires",
        metadata: { page_assets: [{ page_num: 1, artifact_ref: "source.pdf", content_type: "application/pdf", asset_url: "https://s3.example/jobs/job/raw/source.pdf?X-Amz-Signature=expires" }] } }],
      pagination: { page: 1, page_size: 50, total: 1, total_pages: 1 },
    }), { headers: { "content-type": "application/json" } }))
    const page = await knowhereDemoApi.fetchChunkPage({ demoSourceId: "demo-report", jobResultId: "revision-1", page: 1, pageSize: 50 })
    expect(page.chunks[0]?.assetUrl).toBe("/api/demo-sources/demo-report/assets/images/figure-1.png?job_result_id=revision-1")
    expect(page.chunks[0]?.metadata).toMatchObject({ pageAssets: [{ assetUrl: "/api/demo-sources/demo-report/assets/source.pdf?job_result_id=revision-1" }] })
    expect(JSON.stringify(page)).not.toContain("X-Amz")
  })
  it("rejects ready catalog entries missing immutable provenance or using the private namespace", async () => {
    const source = { demo_source_id: "demo-report", canonical_document_id: "ddoc_report", title: "report.pdf", mime_type: "application/pdf", size_bytes: 10, chunk_count: 1, original_file: { url: "/api/v1/demo/sources/demo-report/original", mime_type: "application/pdf", size_bytes: 10, can_download: true } }
    for (const provenance of [{ namespace: "__knowhere_demo__" }, { namespace: "default", job_result_id: "revision-1" }, { namespace: "__knowhere_demo__", job_result_id: "" }]) {
      globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sources: [{ ...source, ...provenance }] }), { headers: { "content-type": "application/json" } }))
      await expect(knowhereDemoApi.fetchCatalog()).rejects.toThrow()
    }
  })
  it("retains import readiness for known sources outside the ready subset", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sources: [], import_status: [{ demo_source_id: "demo-new", status: "processing" }] }), { headers: { "content-type": "application/json" } }))
    expect(await knowhereDemoApi.fetchCatalog()).toMatchObject({ importStatuses: [{ demoSourceId: "demo-new", status: "processing" }] })
  })
  it("accepts empty demo chunk content from parser output", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          demo_source_id: "demo-tsla-q4-2025",
          canonical_document_id: "demo-doc-tsla-q4-2025",
          namespace: "__knowhere_demo__",
          job_result_id: "revision-fixture",
          title: "TSLA-Q4-2025-Update.pdf",
          mime_type: "application/pdf",
          chunks: [
            {
              id: "demo-tsla-q4-2025:chunk-empty",
              chunk_id: "chunk-empty",
              chunk_type: "text",
              content: "",
              section_path: "Default_Root/TSLA-Q4-2025-Update.pdf-->OUTLOOK",
              source_chunk_path: "Default_Root/TSLA-Q4-2025-Update.pdf-->OUTLOOK",
              file_path: null,
              sort_order: 27,
              metadata: {},
              asset_url: null,
            },
          ],
          pagination: {
            page: 1,
            page_size: 100,
            total: 1,
            total_pages: 1,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const page = await knowhereDemoApi.fetchChunkPage({
      demoSourceId: "demo-tsla-q4-2025",
      page: 1,
      pageSize: 100,
    })

    expect(page.chunks[0]).toMatchObject({
      id: "demo-tsla-q4-2025:chunk-empty",
      content: "",
    })
    expect(nextCacheMocks.cacheLife).not.toHaveBeenCalled()
  })

  it("rewrites demo page citation assets onto the Notebook asset proxy", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          demo_source_id: "demo-tsla-q4-2025",
          canonical_document_id: "demo-doc-tsla-q4-2025",
          namespace: "__knowhere_demo__",
          job_result_id: "revision-fixture",
          title: "TSLA-Q4-2025-Update.pdf",
          mime_type: "application/pdf",
          chunks: [
            {
              id: "demo-tsla-q4-2025:page-1",
              chunk_id: "page-1",
              chunk_type: "page",
              content: "Tesla energy storage deployments.",
              section_path: "TSLA-Q4-2025-Update.pdf/SUMMARY",
              source_chunk_path: "TSLA-Q4-2025-Update.pdf/SUMMARY",
              file_path: "page_citation_assets/page-8.png",
              sort_order: 8,
              metadata: {
                page_nums: [8],
                page_assets: [
                  {
                    page_num: 8,
                    artifact_ref: "page_citation_assets/page-8.png",
                    content_type: "image/png",
                    source: "knowhere-rendered-page-citation-source",
                    asset_url:
                      "/api/v1/demo/sources/demo-tsla-q4-2025/assets/page_citation_assets/page-8.png",
                    width: 1200,
                    height: 1600,
                  },
                ],
              },
              asset_url:
                "/api/v1/demo/sources/demo-tsla-q4-2025/assets/page_citation_assets/page-8.png",
            },
          ],
          pagination: {
            page: 1,
            page_size: 100,
            total: 1,
            total_pages: 1,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const page = await knowhereDemoApi.fetchChunkPage({
      demoSourceId: "demo-tsla-q4-2025",
      page: 1,
      pageSize: 100,
    })

    expect(page.chunks[0]).toMatchObject({
      chunkType: "page",
      filePath: "page_citation_assets/page-8.png",
      assetUrl:
        "/api/demo-sources/demo-tsla-q4-2025/assets/page_citation_assets/page-8.png?job_result_id=revision-fixture",
      metadata: {
        pageAssets: [
          {
            pageNum: 8,
            contentType: "image/png",
            assetUrl:
              "/api/demo-sources/demo-tsla-q4-2025/assets/page_citation_assets/page-8.png?job_result_id=revision-fixture",
            width: 1200,
            height: 1600,
          },
        ],
      },
    })
  })

  it("maps Official Library metadata from the demo catalog", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sources: [
            {
              demo_source_id: "demo-spacex-s1",
              canonical_document_id: "demo-doc-spacex-s1",
              namespace: "__knowhere_demo__",
              job_result_id: "revision-fixture",
              title: "spacex-s1.pdf",
              mime_type: "application/pdf",
              size_bytes: 7441414,
              status: "ready",
              chunk_count: 922,
              original_file: {
                url: "/api/v1/demo/sources/demo-spacex-s1/original",
                mime_type: "application/pdf",
                size_bytes: 7441414,
                can_download: false,
              },
              official_library: {
                library_source_id: "financial-spacex-s1",
                category_id: "financial-reports",
                title: "spacex-s1.pdf",
                source_url: "https://data.olivierroy.dev/spacex-s1.pdf",
                mime_type: "application/pdf",
                status: "ready",
                demo_source_id: "demo-spacex-s1",
              },
              examples: [],
            },
          ],
          official_library: {
            categories: [
              {
                category_id: "financial-reports",
                label: "Financial reports",
                description: "Company filings.",
              },
            ],
            sources: [
              {
                library_source_id: "financial-spacex-s1",
                category_id: "financial-reports",
                title: "spacex-s1.pdf",
                source_url: "https://data.olivierroy.dev/spacex-s1.pdf",
                mime_type: "application/pdf",
                status: "ready",
                demo_source_id: "demo-spacex-s1",
                canonical_document_id: "demo-doc-spacex-s1",
                size_bytes: 7441414,
                chunk_count: 922,
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const catalog = await knowhereDemoApi.fetchCatalog()

    expect(catalog.sources[0]?.officialLibrary).toMatchObject({
      librarySourceId: "financial-spacex-s1",
      categoryId: "financial-reports",
      demoSourceId: "demo-spacex-s1",
    })
    expect(catalog.officialLibrary.sources[0]).toMatchObject({
      librarySourceId: "financial-spacex-s1",
      status: "ready",
      chunkCount: 922,
    })
  })

  it("maps demo example citation page metadata onto Notebook citation fields", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sources: [
            {
              demo_source_id: "demo-tsla-q4-2025",
              canonical_document_id: "demo-doc-tsla-q4-2025",
              namespace: "__knowhere_demo__",
              job_result_id: "revision-fixture",
              title: "TSLA-Q4-2025-Update.pdf",
              mime_type: "application/pdf",
              size_bytes: 1024,
              status: "ready",
              chunk_count: 71,
              original_file: {
                url: "/api/v1/demo/sources/demo-tsla-q4-2025/original",
                mime_type: "application/pdf",
                size_bytes: 1024,
                can_download: false,
              },
              examples: [
                {
                  id: "demo-tsla-q4-2025-xai",
                  question: "What does the document say about Tesla's xAI investment?",
                  answer:
                    "Tesla entered an agreement to invest about $2 billion. [[cite:1]]",
                  citations: [
                    {
                      demo_source_id: "demo-tsla-q4-2025",
                      canonical_document_id: "demo-doc-tsla-q4-2025",
                      canonical_chunk_id: "demo-tsla-q4-2025:chunk",
                      chunk_id: "chunk",
                      chunk_type: "page",
                      content: "Tesla entered into an agreement",
                      page_citation_page_number: 12,
                      page_nums: [12],
                      page_citation_asset_url:
                        "/api/v1/demo/sources/demo-tsla-q4-2025/assets/page_citation_assets/page-12.png",
                      source: {
                        document_id: "demo-doc-tsla-q4-2025",
                        source_file_name: "TSLA-Q4-2025-Update.pdf",
                        section_path: "TSLA-Q4-2025-Update.pdf/OTHER UPDATES",
                      },
                    },
                  ],
                },
              ],
            },
          ],
          official_library: { categories: [], sources: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const catalog = await knowhereDemoApi.fetchCatalog()

    expect(catalog.sources[0]?.examples[0]?.citations[0]).toMatchObject({
      pageCitationPageNumber: 12,
      pageNums: [12],
      pageCitationAssetUrl:
        "/api/demo-sources/demo-tsla-q4-2025/assets/page_citation_assets/page-12.png",
    })
  })

  it("maps shared-corpus demo citations without legacy nested fields", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sources: [
            {
              demo_source_id: "demo-tsla-q4-2025",
              canonical_document_id: "ddoc_d55868b790cd",
              namespace: "__knowhere_demo__",
              job_result_id: "revision-fixture",
              title: "TSLA-Q4-2025-Update.pdf",
              mime_type: "application/pdf",
              size_bytes: 5648867,
              import_status: "ready",
              chunk_count: 71,
              original_file: {
                url: "/api/v1/demo/sources/demo-tsla-q4-2025/original",
                mime_type: "application/pdf",
                size_bytes: 5648867,
                can_download: true,
              },
              examples: [
                {
                  id: "demo-tsla-q4-2025-xai",
                  question: "What does the document say about Tesla's xAI investment?",
                  answer: "Tesla invested in xAI. [[cite:1]]",
                  citations: [
                    {
                      description: "xAI investment",
                      document_id: "ddoc_d55868b790cd",
                      canonical_document_id: "ddoc_d55868b790cd",
                      job_result_id: "afc92902-5846-4d11-b658-2ccaf4f04242",
                      demo_source_id: "demo-tsla-q4-2025",
                      id: "dchk_1236885e2eda",
                      demo_chunk_id: "dchk_1236885e2eda",
                      chunk_id: "node_5ead044d-60cc-5b64-a066-fa6c0a81bbd6",
                      section_path: "Q4 and FY 2025 Update / OTHER UPDATES",
                      content:
                        "On January 16, 2026, Tesla entered into an agreement to invest approximately",
                      page_number: 12,
                    },
                  ],
                },
              ],
            },
          ],
          official_library: { categories: [], sources: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const catalog = await knowhereDemoApi.fetchCatalog()
    const citation = catalog.sources[0]?.examples[0]?.citations[0]

    expect(citation).toMatchObject({
      demoSourceId: "demo-tsla-q4-2025",
      canonicalDocumentId: "ddoc_d55868b790cd",
      canonicalChunkId: "dchk_1236885e2eda",
      chunkId: "node_5ead044d-60cc-5b64-a066-fa6c0a81bbd6",
      chunkType: "text",
      content:
        "On January 16, 2026, Tesla entered into an agreement to invest approximately",
      pageCitationPageNumber: 12,
      pageNums: [12],
      source: {
        documentId: "ddoc_d55868b790cd",
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Q4 and FY 2025 Update / OTHER UPDATES",
      },
    })
  })

  it("normalizes shared-corpus chunk pages with catalog metadata fallback", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            document_id: "ddoc_d55868b790cd",
            namespace: "__knowhere_demo__",
            job_result_id: "afc92902-5846-4d11-b658-2ccaf4f04242",
            chunks: [
              {
                id: "dchk_1236885e2eda",
                chunk_id: "node_5ead044d-60cc-5b64-a066-fa6c0a81bbd6",
                chunk_type: "text",
                content: "Tesla entered into an agreement to invest approximately",
                section_path: "Q4 and FY 2025 Update / OTHER UPDATES",
                source_chunk_path:
                  "Q4 and FY 2025 Update / OTHER UPDATES",
                file_path: null,
                sort_order: 0,
                metadata: { page_nums: [12] },
                asset_url: null,
              },
            ],
            pagination: { page: 1, page_size: 50, total: 1, total_pages: 1 },
            demo_source_id: undefined,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sources: [
              {
                demo_source_id: "demo-tsla-q4-2025",
                canonical_document_id: "ddoc_d55868b790cd",
                namespace: "__knowhere_demo__",
                job_result_id: "revision-fixture",
                title: "TSLA-Q4-2025-Update.pdf",
                mime_type: "application/pdf",
                size_bytes: 5648867,
                import_status: "ready",
                chunk_count: 71,
                original_file: {
                  url: "/api/v1/demo/sources/demo-tsla-q4-2025/original",
                  mime_type: "application/pdf",
                  size_bytes: 5648867,
                  can_download: true,
                },
                examples: [],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

    const page = await knowhereDemoApi.fetchChunkPage({
      demoSourceId: "demo-tsla-q4-2025",
      page: 1,
      pageSize: 50,
    })

    expect(page).toMatchObject({
      demoSourceId: "demo-tsla-q4-2025",
      canonicalDocumentId: "ddoc_d55868b790cd",
      title: "TSLA-Q4-2025-Update.pdf",
      mimeType: "application/pdf",
    })
    expect(page.chunks[0]).toMatchObject({
      id: "dchk_1236885e2eda",
      chunkId: "node_5ead044d-60cc-5b64-a066-fa6c0a81bbd6",
      sectionPath: "Q4 and FY 2025 Update / OTHER UPDATES",
    })
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      new URL("https://api.knowhereto.ai/api/v1/demo/sources/demo-tsla-q4-2025/chunks?page=1&page_size=50"),
      expect.objectContaining({ cache: "no-store" }),
    )
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      new URL("https://api.knowhereto.ai/api/v1/demo/catalog"),
      expect.objectContaining({ cache: "no-store" }),
    )
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
