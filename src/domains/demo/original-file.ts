import type { SourceOriginalFileView } from "@/domains/sources/types"

type DemoOriginalSource = {
  readonly demoSourceId: string
  readonly jobResultId?: string
  readonly originalFile: {
    readonly url: string
    readonly mimeType: string
    readonly sizeBytes: number
    readonly canDownload: boolean
  }
}

export const demoOriginalFile = { getPublicUrl, toSourceOriginalFileView } as const

function toSourceOriginalFileView(source: DemoOriginalSource): SourceOriginalFileView {
  return {
    url: getPublicUrl(source),
    mimeType: source.originalFile.mimeType,
    sizeBytes: source.originalFile.sizeBytes,
    canDownload: source.originalFile.canDownload,
    pdfPreviewMode: "browser",
  }
}

function getPublicUrl(source: DemoOriginalSource): string {
  const originalUrl: URL = new URL(source.originalFile.url, "https://notebook.invalid")
  const jobResultId: string | null | undefined = source.jobResultId ?? originalUrl.searchParams.get("job_result_id")
  const parameters: URLSearchParams = new URLSearchParams()
  if (jobResultId) parameters.set("job_result_id", jobResultId)
  const query: string = parameters.size > 0 ? `?${parameters.toString()}` : ""
  return `/api/demo-sources/${encodeURIComponent(source.demoSourceId)}/original${query}`
}
