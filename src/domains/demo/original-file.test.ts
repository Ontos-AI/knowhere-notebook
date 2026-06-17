import { describe, expect, it } from "vitest"

import { demoOriginalFile } from "@/domains/demo/original-file"

describe("demoOriginalFile", () => {
  it("keeps public original URLs for demo source preview", () => {
    expect(
      demoOriginalFile.getPublicUrl(
        makeDemoOriginalSource({
          originalUrl: "https://example.com/report.pdf",
        }),
      ),
    ).toBe("https://example.com/report.pdf")
  })

  it("falls back to the Official Library file URL instead of Knowhere API originals", () => {
    const source = makeDemoOriginalSource({
      originalUrl:
        "https://api.knowhere.example/api/v1/demo/sources/demo-report/original",
      sourceUrl: "https://example.com/library-report.pdf",
    })

    expect(demoOriginalFile.getPublicUrl(source)).toBe(
      "https://example.com/library-report.pdf",
    )
    expect(demoOriginalFile.toSourceOriginalFileView(source)).toMatchObject({
      url: "https://example.com/library-report.pdf",
      pdfPreviewMode: "browser",
    })
  })

  it("returns no original URL for legacy demo originals without a public file", () => {
    expect(
      demoOriginalFile.getPublicUrl(
        makeDemoOriginalSource({
          originalUrl:
            "https://api.knowhere.example/api/v1/demo/sources/demo-report/original",
        }),
      ),
    ).toBeNull()
  })
})

function makeDemoOriginalSource({
  originalUrl,
  sourceUrl,
}: {
  readonly originalUrl: string
  readonly sourceUrl?: string
}): Parameters<typeof demoOriginalFile.getPublicUrl>[0] {
  return {
    originalFile: {
      url: originalUrl,
      mimeType: "application/pdf",
      sizeBytes: 1024,
      canDownload: false,
    },
    ...(sourceUrl
      ? {
          officialLibrary: {
            sourceUrl,
          },
        }
      : {}),
  }
}
