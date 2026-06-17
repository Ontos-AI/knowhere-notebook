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
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
