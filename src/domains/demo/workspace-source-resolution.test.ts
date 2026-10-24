import { describe, expect, it } from "vitest"
import type { Source } from "@/infrastructure/db/schema"
import type { DemoCatalog } from "@/integrations/knowhere-demo"
import { resolveWorkspaceDemoSources } from "./workspace-source-resolution"

const catalog: DemoCatalog = { officialLibrary: { categories: [], sources: [] }, sources: [{
  demoSourceId: "demo-report", canonicalDocumentId: "ddoc_report", namespace: "__knowhere_demo__", jobResultId: "revision-1",
  title: "report.pdf", mimeType: "application/pdf", sizeBytes: 10, status: "ready", chunkCount: 4,
  originalFile: { url: "/api/v1/demo/sources/demo-report/original", mimeType: "application/pdf", sizeBytes: 10, canDownload: true }, examples: [],
}] }
const legacySource: Source = {
  id: "source-old-copy", workspaceId: "workspace-1", title: "report.pdf", mimeType: "application/pdf", sizeBytes: 10, status: "ready",
  failureReason: null, failureStage: null, knowhereJobId: null, knowhereDocumentId: "private-copy",
  stagedBlobPathname: null, stagedBlobUrl: null, originalBlobPathname: null, originalBlobUrl: null, demoKey: "demo-report", chunkCount: 4, folderId: null,
  createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null,
}
describe("resolveWorkspaceDemoSources", () => {
  it("replaces every legacy demo row with the current shared catalog identity", () => {
    const result = resolveWorkspaceDemoSources([legacySource], catalog)
    expect(result.workspaceSources).toEqual([])
    expect(result.demoSources).toEqual([expect.objectContaining({ id: "demo-report", kind: "demo", documentId: "ddoc_report", namespace: "__knowhere_demo__", jobResultId: "revision-1" })])
  })
  it("preserves only private rows while respecting hidden shared selections", () => {
    const privateSource: Source = { ...legacySource, id: "source-private", demoKey: null }
    const result = resolveWorkspaceDemoSources([legacySource, privateSource], catalog, new Set(["demo-report"]))
    expect(result.workspaceSources).toEqual([privateSource])
    expect(result.demoSources).toEqual([])
  })
  it("marks explicitly selected official entries as ordinary queryable shared sources", () => {
    const source = catalog.sources[0]!
    const officialCatalog: DemoCatalog = { ...catalog, sources: [{ ...source, officialLibrary: {
      librarySourceId: "official-report", categoryId: "reports", title: "report.pdf", sourceUrl: "https://example.com/report.pdf", mimeType: "application/pdf", status: "ready",
    } }] }
    const result = resolveWorkspaceDemoSources([], officialCatalog, new Set(), new Set(["demo-report"]))
    expect(result.demoSources[0]?.officialLibrary).toBeUndefined()
    expect(result.demoSources[0]?.kind).toBe("demo")
  })
})
