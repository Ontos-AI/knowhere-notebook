import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ getOptionalAuthenticated: vi.fn(), listHiddenDemoSourceIds: vi.fn(), restoreDemoSource: vi.fn(), fetchCatalog: vi.fn(), materializeSources: vi.fn(), upsertMaterializedDemoSource: vi.fn() }))
vi.mock("@/domains/workspace/request-context", () => ({ notebookRequestContext: { getOptionalAuthenticated: mocks.getOptionalAuthenticated } }))
vi.mock("@/domains/sources/service", () => ({ sourceService: { listHiddenDemoSourceIds: mocks.listHiddenDemoSourceIds, restoreDemoSource: mocks.restoreDemoSource, upsertMaterializedDemoSource: mocks.upsertMaterializedDemoSource } }))
vi.mock("@/integrations/knowhere-demo", () => ({ knowhereDemoApi: { fetchCatalog: mocks.fetchCatalog, materializeSources: mocks.materializeSources } }))
import { POST } from "./route"
const source = { demoSourceId: "demo-report", canonicalDocumentId: "ddoc_report", jobResultId: "revision-1", namespace: "__knowhere_demo__", title: "report.pdf", mimeType: "application/pdf", sizeBytes: 10, status: "ready", chunkCount: 4, originalFile: { url: "/api/v1/demo/sources/demo-report/original?job_result_id=revision-1", mimeType: "application/pdf", sizeBytes: 10, canDownload: true }, examples: [] }
describe("POST /api/demo-sources/materialize compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getOptionalAuthenticated.mockResolvedValue({ workspace: { id: "workspace-1" } })
    mocks.listHiddenDemoSourceIds.mockResolvedValue([])
    mocks.fetchCatalog.mockResolvedValue({ sources: [source], officialLibrary: { sources: [], categories: [] } })
  })
  it("returns shared metadata without copying rows or contacting materializations", async () => {
    const response = await POST(request(["demo-report"]))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sources: [{ id: "demo-report", kind: "demo", documentId: "ddoc_report", jobResultId: "revision-1" }] })
    expect(mocks.materializeSources).not.toHaveBeenCalled()
    expect(mocks.upsertMaterializedDemoSource).not.toHaveBeenCalled()
    expect(mocks.restoreDemoSource).not.toHaveBeenCalled()
  })
  it("never restores a hidden demo", async () => {
    mocks.listHiddenDemoSourceIds.mockResolvedValue(["demo-report"])
    const response = await POST(request(["demo-report"]))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sources: [] })
    expect(mocks.restoreDemoSource).not.toHaveBeenCalled()
  })
})
function request(demoSourceIds: readonly string[]): Request { return new Request("http://localhost/api/demo-sources/materialize", { method: "POST", body: JSON.stringify({ demoSourceIds }) }) }
