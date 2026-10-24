import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock("@/integrations/knowhere-demo", () => ({
  knowhereDemoApi: {
    resolveApiURL: (pathname: string) => `https://demo.example${pathname}`,
  },
}))

import { GET } from "./route"

describe("GET /api/demo-sources/[demoSourceId]/assets/[...assetPath]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", mocks.fetch)
  })

  it("pins Range reads to the requested complete revision and preserves response headers", async () => {
    mocks.fetch.mockResolvedValue(new Response("bytes", { status: 206, headers: { "content-type": "image/png", "content-range": "bytes 0-4/100", "accept-ranges": "bytes", "etag": "revision-one" } }))
    const response = await GET(new Request("http://localhost/api/demo-sources/demo_1/assets/pages/1.png?job_result_id=revision-one", { headers: { range: "bytes=0-4" } }), { params: Promise.resolve({ demoSourceId: "demo_1", assetPath: ["pages", "1.png"] }) })
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe("bytes 0-4/100")
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(mocks.fetch).toHaveBeenCalledWith(new URL("https://demo.example/api/v1/demo/sources/demo_1/assets/pages/1.png?job_result_id=revision-one"), expect.objectContaining({ headers: expect.objectContaining({ range: "bytes=0-4" }) }))
  })
  it("preserves upstream preparing and unsatisfiable Range status", async () => {
    for (const status of [409, 416, 503]) {
      mocks.fetch.mockResolvedValue(new Response("unavailable", { status, headers: { "content-range": "bytes */100" } }))
      const response = await GET(new Request("http://localhost/api/demo-sources/demo_1/assets/pages/1.png"), { params: Promise.resolve({ demoSourceId: "demo_1", assetPath: ["pages", "1.png"] }) })
      expect(response.status).toBe(status)
      expect(response.headers.get("content-range")).toBe("bytes */100")
    }
  })
  it("rejects traversal before contacting Knowhere", async () => {
    const response = await GET(new Request("http://localhost/api/demo-sources/demo_1/assets/bad"), { params: Promise.resolve({ demoSourceId: "demo_1", assetPath: ["..", "secret"] }) })
    expect(response.status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it("serves demo image assets inline", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("image bytes", {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      }),
    )

    const response = await GET(
      new Request(
        "http://localhost:3001/api/demo-sources/demo_1/assets/images/page-1.png",
      ),
      {
        params: Promise.resolve({
          demoSourceId: "demo_1",
          assetPath: ["images", "page-1.png"],
        }),
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(response.headers.get("content-disposition")).toBe("inline")
    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL("https://demo.example/api/v1/demo/sources/demo_1/assets/images/page-1.png"),
      expect.objectContaining({ cache: "no-store" }),
    )
  })
})
