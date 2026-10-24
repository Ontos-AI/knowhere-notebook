import { describe, expect, it, vi } from "vitest"
import type { Source } from "@/infrastructure/db/schema"
import { createSourceRouteService } from "./route-service"

const sharedSource = { demoSourceId: "demo-report", canonicalDocumentId: "ddoc_report", namespace: "__knowhere_demo__", jobResultId: "revision-1", title: "report.pdf", mimeType: "application/pdf", sizeBytes: 10, status: "ready" as const, chunkCount: 4, originalFile: { url: "/api/v1/demo/sources/demo-report/original", mimeType: "application/pdf", sizeBytes: 10, canDownload: true }, examples: [] }
const localSource: Source = { id: "81ec8318-ae96-4c17-85fc-64ece5f752f5", workspaceId: "workspace-1", title: "report.pdf", mimeType: "application/pdf", sizeBytes: 10, status: "ready", failureReason: null, failureStage: null, knowhereJobId: null, knowhereDocumentId: "ddoc_report", stagedBlobPathname: null, stagedBlobUrl: null, originalBlobPathname: null, originalBlobUrl: null, demoKey: "demo-report", chunkCount: 4, folderId: null, createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null }
function createArchiveService(source: Source | null = null) {
  const archive = vi.fn(async () => undefined)
  const softDelete = vi.fn(async () => true)
  const hideDemoSource = vi.fn(async () => undefined)
  const fetchCatalog = vi.fn(async () => ({ sources: [sharedSource], officialLibrary: { categories: [], sources: [] } }))
  const service = createSourceRouteService({
    demoApi: { fetchCatalog },
    ensureWorkspace: vi.fn(async () => ({ id: "workspace-1", userId: "user-1", namespace: "private", createdAt: new Date(0) })),
    requireUser: vi.fn(async () => ({ id: "user-1", email: null, name: null })),
    ensureApiKeyForWorkspace: vi.fn(async () => "jwt"),
    makeKnowhereClient: vi.fn(() => ({ documents: { archive, listChunks: vi.fn() }, jobs: { create: vi.fn(), get: vi.fn(), upload: vi.fn() } })),
    sourceService: { findInWorkspace: vi.fn(async () => source), findByKnowhereDocumentId: vi.fn(async () => localSource), hideDemoSource, softDelete },
  })
  return { service, archive, hideDemoSource, softDelete, fetchCatalog }
}
describe("shared demo removal", () => {
  it("hides a stale local demo row without deleting its old citation metadata", async () => {
    const operations = createArchiveService(localSource)
    expect((await operations.service.archiveSource({ sourceId: localSource.id, cookieHeader: "" })).status).toBe(200)
    expect(operations.hideDemoSource).toHaveBeenCalledWith("workspace-1", "demo-report")
    expect(operations.archive).not.toHaveBeenCalled()
    expect(operations.softDelete).not.toHaveBeenCalled()
  })
  it("guards a stale non-demo UUID referencing a shared canonical document", async () => {
    const operations = createArchiveService({ ...localSource, demoKey: null })
    expect((await operations.service.archiveSource({ sourceId: localSource.id, cookieHeader: "" })).status).toBe(200)
    expect(operations.archive).not.toHaveBeenCalled()
    expect(operations.softDelete).not.toHaveBeenCalled()
  })
  it("guards shared remote IDs and only updates visibility", async () => {
    const operations = createArchiveService()
    expect((await operations.service.archiveSource({ sourceId: "knowhere-doc:__knowhere_demo__:ddoc_report", cookieHeader: "" })).status).toBe(200)
    expect(operations.hideDemoSource).toHaveBeenCalledWith("workspace-1", "demo-report")
    expect(operations.archive).not.toHaveBeenCalled()
  })
  it("hides a stale remote ID for an old personal demo copy without destroying citation metadata", async () => {
    const operations = createArchiveService()
    expect((await operations.service.archiveSource({ sourceId: "knowhere-doc:default:doc-old-copy", cookieHeader: "" })).status).toBe(200)
    expect(operations.hideDemoSource).toHaveBeenCalledWith("workspace-1", "demo-report")
    expect(operations.archive).not.toHaveBeenCalled()
    expect(operations.softDelete).not.toHaveBeenCalled()
  })
  it("archives a known private source independently of demo catalog availability", async () => {
    const operations = createArchiveService({ ...localSource, demoKey: null, knowhereDocumentId: "doc-private" })
    operations.fetchCatalog.mockRejectedValue(new Error("catalog unavailable"))
    expect((await operations.service.archiveSource({ sourceId: localSource.id, cookieHeader: "" })).status).toBe(200)
    expect(operations.fetchCatalog).not.toHaveBeenCalled()
    expect(operations.archive).toHaveBeenCalledWith("doc-private")
    expect(operations.softDelete).toHaveBeenCalledWith("workspace-1", localSource.id)
  })
  it("never archives an unknown shared document disguised as a default namespace remote", async () => {
    const operations = createArchiveService()
    expect((await operations.service.archiveSource({ sourceId: "knowhere-doc:default:ddoc_unknown", cookieHeader: "" })).status).toBe(404)
    expect(operations.archive).not.toHaveBeenCalled()
  })
  it("never archives unknown shared remote documents", async () => {
    const operations = createArchiveService()
    expect((await operations.service.archiveSource({ sourceId: "knowhere-doc:__knowhere_demo__:ddoc_unknown", cookieHeader: "" })).status).toBe(404)
    expect(operations.archive).not.toHaveBeenCalled()
  })
})
