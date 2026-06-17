import type { SourceOriginalFileView } from "@/domains/sources/types"

type DemoOriginalSource = {
  readonly originalFile: {
    readonly url: string
    readonly mimeType: string
    readonly sizeBytes: number
    readonly canDownload: boolean
  }
  readonly officialLibrary?: {
    readonly sourceUrl: string
  }
}

export const demoOriginalFile = {
  getPublicUrl,
  toSourceOriginalFileView,
} as const

function toSourceOriginalFileView(
  source: DemoOriginalSource,
): SourceOriginalFileView | null {
  const url = getPublicUrl(source)
  if (!url) return null

  return {
    url,
    mimeType: source.originalFile.mimeType,
    sizeBytes: source.originalFile.sizeBytes,
    canDownload: source.originalFile.canDownload,
    pdfPreviewMode: "browser",
  }
}

function getPublicUrl(source: DemoOriginalSource): string | null {
  const originalUrl = toPublicHttpUrl(source.originalFile.url)
  if (originalUrl) return originalUrl

  return source.officialLibrary
    ? toPublicHttpUrl(source.officialLibrary.sourceUrl)
    : null
}

function toPublicHttpUrl(value: string): string | null {
  try {
    const parsedUrl = new URL(value)
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null
    }
    if (isDemoOriginalProxyPath(parsedUrl.pathname)) return null
    return parsedUrl.toString()
  } catch {
    return null
  }
}

function isDemoOriginalProxyPath(pathname: string): boolean {
  return (
    /^\/api\/v1\/demo\/sources\/[^/]+\/original\/?$/.test(pathname) ||
    /^\/api\/demo-sources\/[^/]+\/original\/?$/.test(pathname)
  )
}
