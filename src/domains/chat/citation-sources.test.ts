import { describe, expect, it } from "vitest"
import { resolveCitationSources } from "./citation-sources"
import type { Source } from "@/infrastructure/db/schema"
import type { DemoCatalog } from "@/integrations/knowhere-demo"
import type { ChatMessageView } from "./types"

const catalog: DemoCatalog = { sources: [{ demoSourceId: "demo-report", canonicalDocumentId: "shared_doc", namespace: "__knowhere_demo__", jobResultId: "current", title: "Report", mimeType: "application/pdf", sizeBytes: 1, status: "ready", chunkCount: 1, originalFile: { url: "/demo", mimeType: "application/pdf", sizeBytes: 1, canDownload: false }, examples: [] }], officialLibrary: { categories: [], sources: [] } }
function makeMessages(documentId: string, namespace?: string, jobResultId?: string): ChatMessageView[] {
  return [{ id: "m", role: "assistant", content: "Answer", citations: [{ chunkType: "text", score: 1, source: { documentId, namespace, jobResultId } }] }]
}

describe("resolveCitationSources", () => {
  it("returns hidden shared source metadata at the saved revision", () => {
    expect(resolveCitationSources({ messages: makeMessages("shared_doc", "__knowhere_demo__", "saved"), sources: [], catalog, namespace: "personal" })).toMatchObject([{ id: "demo-report", documentId: "shared_doc", jobResultId: "saved", namespace: "__knowhere_demo__" }])
    expect(resolveCitationSources({ messages: makeMessages("shared_doc", "__knowhere_demo__", "saved"), sources: [], catalog, namespace: "personal" })[0]?.originalFile?.url).toContain("job_result_id=saved")
  })
  it("uses the compatible actual private namespace from a saved citation", () => {
    const source = { id: "private", knowhereDocumentId: "private_doc", title: "Report", mimeType: "application/pdf", status: "ready", knowhereJobId: "job" } as Source
    expect(resolveCitationSources({ messages: makeMessages("private_doc", "default", "saved"), sources: [source], catalog, namespace: "notebook-personal" })).toMatchObject([{ id: "private", namespace: "default", jobResultId: "saved" }])
    expect(resolveCitationSources({ messages: makeMessages("private_doc", "other-tenant", "saved"), sources: [source], catalog, namespace: "notebook-personal" })).toEqual([])
  })
  it("does not redirect unresolved old demo document identifiers to the shared corpus", () => {
    expect(resolveCitationSources({ messages: makeMessages("old_static_doc"), sources: [], catalog, namespace: "personal" })).toEqual([])
  })
  it("resolves private legacy rows using their actual document and namespace", () => {
    const source = { id: "legacy", knowhereDocumentId: "private_doc", title: "Report", mimeType: "application/pdf", status: "ready", demoKey: "demo-report", knowhereJobId: "job" } as Source
    expect(resolveCitationSources({ messages: makeMessages("private_doc"), sources: [source], catalog, namespace: "personal" })).toMatchObject([{ id: "legacy", documentId: "private_doc", namespace: "personal", kind: "workspace" }])
  })
})
