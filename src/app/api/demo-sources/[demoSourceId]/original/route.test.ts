import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("@/integrations/knowhere-demo", () => ({ knowhereDemoApi: { resolveApiURL: (path: string) => `https://demo.example${path}` } }))
import { GET } from "./route"
afterEach(() => vi.unstubAllGlobals())
describe("shared demo original proxy", () => {
  it("preserves revision, Range and partial original disposition", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("bytes", { status: 206, headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=report.pdf", "content-range": "bytes 0-4/100", "content-length": "5" } }))
    vi.stubGlobal("fetch", fetcher)
    const response = await GET(new Request("http://localhost/api/demo-sources/demo-report/original?job_result_id=revision-one", { headers: { range: "bytes=0-4" } }), { params: Promise.resolve({ demoSourceId: "demo-report" }) })
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe("bytes 0-4/100")
    expect(response.headers.get("content-disposition")).toBe("inline; filename=report.pdf")
    expect(response.headers.get("content-length")).toBe("5")
    expect(await response.text()).toBe("bytes")
    expect(fetcher).toHaveBeenCalledWith(new URL("https://demo.example/api/v1/demo/sources/demo-report/original?job_result_id=revision-one"), expect.objectContaining({ cache: "no-store", headers: expect.objectContaining({ range: "bytes=0-4" }) }))
  })
})
