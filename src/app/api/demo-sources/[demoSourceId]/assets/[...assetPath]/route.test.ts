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
      "https://demo.example/api/v1/demo/sources/demo_1/assets/images/page-1.png",
      { cache: "no-store" },
    )
  })
})
