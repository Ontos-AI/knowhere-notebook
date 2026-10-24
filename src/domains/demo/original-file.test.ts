import { describe, expect, it } from "vitest"
import { demoOriginalFile } from "./original-file"

describe("demoOriginalFile", () => {
  it("uses a stable same-origin revision proxy for catalog originals", () => {
    const source = {
      demoSourceId: "demo-report",
      jobResultId: "revision-1",
      originalFile: {
        url: "/api/v1/demo/sources/demo-report/original?job_result_id=revision-1",
        mimeType: "application/pdf", sizeBytes: 1024, canDownload: true,
      },
    }
    expect(demoOriginalFile.getPublicUrl(source)).toBe("/api/demo-sources/demo-report/original?job_result_id=revision-1")
    expect(demoOriginalFile.toSourceOriginalFileView(source)).toMatchObject({ canDownload: true })
  })
  it("does not retain signed or curated external URLs for shared original files", () => {
    expect(demoOriginalFile.getPublicUrl({
      demoSourceId: "demo-report", jobResultId: "revision-2",
      originalFile: { url: "https://storage.example/report.pdf?signature=expired", mimeType: "application/pdf", sizeBytes: 10, canDownload: false },
    })).toBe("/api/demo-sources/demo-report/original?job_result_id=revision-2")
  })
})
