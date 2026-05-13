import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchChunkPageEffect, knowhereDemoApi } from "./knowhere-demo"

describe("knowhereDemoApi", () => {
  const originalBaseURL = process.env.KNOWHERE_BASE_URL
  const originalFetch = globalThis.fetch

  afterEach(() => {
    restoreEnv("KNOWHERE_BASE_URL", originalBaseURL)
    globalThis.fetch = originalFetch
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

    const page = await Effect.runPromise(
      fetchChunkPageEffect({
        demoSourceId: "demo-tsla-q4-2025",
        page: 1,
        pageSize: 100,
      }),
    )

    expect(page.chunks[0]).toMatchObject({
      id: "demo-tsla-q4-2025:chunk-empty",
      content: "",
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
