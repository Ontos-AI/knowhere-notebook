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

  it("uses deploy-lifetime cache profiles for demo catalog data", async () => {
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

    expect(nextCacheMocks.cacheLife).toHaveBeenCalledWith("max")
    expect(nextCacheMocks.cacheTag).toHaveBeenCalledWith("demo-catalog")
  })

  it("accepts empty demo chunk content from parser output", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          demo_source_id: "demo-tsla-q4-2025",
          canonical_document_id: "demo-doc-tsla-q4-2025",
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
    expect(nextCacheMocks.cacheLife).toHaveBeenCalledWith("max")
    expect(nextCacheMocks.cacheTag).toHaveBeenCalledWith(
      "demo-chunks",
      "demo-tsla-q4-2025",
    )
  })

  it("rewrites demo page citation assets onto the Notebook asset proxy", async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          demo_source_id: "demo-tsla-q4-2025",
          canonical_document_id: "demo-doc-tsla-q4-2025",
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
        "/api/demo-sources/demo-tsla-q4-2025/assets/page_citation_assets/page-8.png",
      metadata: {
        pageAssets: [
          {
            pageNum: 8,
            contentType: "image/png",
            assetUrl:
              "/api/demo-sources/demo-tsla-q4-2025/assets/page_citation_assets/page-8.png",
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
      pageCitationAssetUrl:
        "/api/demo-sources/demo-tsla-q4-2025/assets/page_citation_assets/page-12.png",
    })
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
