import { beforeEach, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
const mocks = vi.hoisted(() => ({ getOptionalAuthenticated: vi.fn(), listHiddenDemoSourceIds: vi.fn(), restoreDemoSource: vi.fn(), fetchCatalog: vi.fn() }))
vi.mock("@/domains/workspace/request-context", () => ({ notebookRequestContext: { getOptionalAuthenticated: mocks.getOptionalAuthenticated } }))
vi.mock("@/domains/sources/service", () => ({ sourceService: { listHiddenDemoSourceIds: mocks.listHiddenDemoSourceIds, restoreDemoSource: mocks.restoreDemoSource } }))
vi.mock("@/integrations/knowhere-demo", () => ({ knowhereDemoApi: { fetchCatalog: mocks.fetchCatalog } }))
import { POST } from "./route"
const source = { demoSourceId: "demo-report", canonicalDocumentId: "ddoc_report", jobResultId: "revision-1", namespace: "__knowhere_demo__", title: "report.pdf", mimeType: "application/pdf", sizeBytes: 10, status: "ready", chunkCount: 4, originalFile: { url: "/api/v1/demo/sources/demo-report/original", mimeType: "application/pdf", sizeBytes: 10, canDownload: true }, examples: [], officialLibrary: { librarySourceId: "official-report", categoryId: "reports", sourceUrl: "https://example.com/report.pdf" } }
describe("POST /api/demo-sources/select", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getOptionalAuthenticated.mockResolvedValue({ workspace: { id: "workspace-1" } })
    mocks.listHiddenDemoSourceIds.mockResolvedValue(["demo-report"])
    mocks.restoreDemoSource.mockResolvedValue(undefined)
    mocks.fetchCatalog.mockResolvedValue({ sources: [source], officialLibrary: { sources: [{ demoSourceId: "demo-preparing", status: "planned" }], categories: [] } })
  })
  it("restores visibility once per selected ID and returns queryable current metadata", async () => {
    const response = await POST(request(["demo-report", "demo-report"]))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ sources: [{ id: "demo-report", kind: "demo", namespace: "__knowhere_demo__", documentId: "ddoc_report", jobResultId: "revision-1" }] })
    expect(result.sources[0].officialLibrary).toBeUndefined()
    expect(mocks.restoreDemoSource).toHaveBeenCalledExactlyOnceWith("workspace-1", "demo-report")
  })
  it("requires authentication", async () => {
    mocks.getOptionalAuthenticated.mockResolvedValue(null)
    const response = await POST(request(["demo-report"]))
    expect(response.status).toBe(401)
    expect(mocks.restoreDemoSource).not.toHaveBeenCalled()
  })
  it("rejects a whole selection before writes when any ID is unknown", async () => {
    const response = await POST(request(["demo-report", "unknown"]))
    expect(response.status).toBe(404)
    expect(mocks.restoreDemoSource).not.toHaveBeenCalled()
  })
  it("reports known preparing selections", async () => {
    const response = await POST(request(["demo-preparing"]))
    expect(response.status).toBe(409)
    expect(mocks.restoreDemoSource).not.toHaveBeenCalled()
  })
  it("recognizes preparing IDs listed outside the Official Library", async () => {
    mocks.fetchCatalog.mockResolvedValue({ sources: [], importStatuses: [{ demoSourceId: "demo-preparing", status: "processing" }], officialLibrary: { sources: [], categories: [] } })
    const response = await POST(request(["demo-preparing"]))
    expect(response.status).toBe(409)
    expect(mocks.restoreDemoSource).not.toHaveBeenCalled()
  })
  it("preserves known upstream statuses across Effect promise failures", async () => {
    for (const status of [401, 404, 409, 503]) {
      mocks.fetchCatalog.mockImplementation(() => Effect.runPromise(Effect.fail({ _tag: "KnowhereDemoApiError", status, body: "upstream internal diagnostic" })))
      const response = await POST(request(["demo-report"]))
      expect(response.status).toBe(status)
      expect(await response.text()).not.toContain("internal diagnostic")
    }
  })
  it("rejects invalid IDs instead of silently filtering them", async () => {
    const response = await POST(new Request("http://localhost/api/demo-sources/select", { method: "POST", body: JSON.stringify({ demoSourceIds: ["demo-report", 2] }) }))
    expect(response.status).toBe(400)
    expect(mocks.restoreDemoSource).not.toHaveBeenCalled()
  })
})
function request(demoSourceIds: readonly string[]): Request { return new Request("http://localhost/api/demo-sources/select", { method: "POST", body: JSON.stringify({ demoSourceIds }) }) }
