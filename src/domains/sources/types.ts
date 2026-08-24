export type SourceStatus = "uploading" | "parsing" | "ready" | "failed"

export type SourceOriginalFileView = {
  readonly url: string
  readonly mimeType: string
  readonly sizeBytes?: number
  readonly canDownload?: boolean
  readonly pdfPreviewMode?: "browser"
}

export type SourceKind = "workspace" | "demo" | "remote"

export type SourceOfficialLibraryView = {
  readonly librarySourceId: string
  readonly categoryId: string
  readonly sourceUrl: string
}

export type SourceDocumentPresentation =
  | { readonly kind: "parsed-chunks" }
  | { readonly kind: "page-assets"; readonly pageCount: number }

export type SourcePageAssetView = {
  readonly pageNumber: number
  readonly assetUrl: string
  readonly contentType: string
  readonly width?: number
  readonly height?: number
}

export type OfficialLibrarySourceView = {
  readonly librarySourceId: string
  readonly categoryId: string
  readonly categoryLabel: string
  readonly title: string
  readonly sourceUrl: string
  readonly mimeType: string
  readonly status: "ready" | "planned"
  readonly demoSourceId?: string
  readonly chunkCount?: number
}

/**
 * Sources sidebar row. Metadata-only, per the MVP persistence rule.
 */
export type SourceView = {
  readonly id: string
  readonly kind?: SourceKind
  readonly demoSourceId?: string
  readonly namespace?: string
  readonly title: string
  /** Browser-provided content type for preview routing. */
  readonly mimeType: string
  readonly status: SourceStatus
  /** Brief user-visible parse failure reason. Present only for failed rows. */
  readonly failureMessage?: string
  /** Knowhere document ID once parsing publishes. */
  readonly documentId?: string
  /** Public Blob URL for original-file preview and download. */
  readonly originalFile?: SourceOriginalFileView
  /** Official Library metadata when this row is an API-owned catalog item. */
  readonly officialLibrary?: SourceOfficialLibraryView
  /** Count from the Notebook parsed snapshot manifest when available. */
  readonly chunkCount?: number
  /**
   * Preferred source content presentation. Missing values are treated as
   * parsed chunks so older views and cached responses remain compatible.
   */
  readonly documentPresentation?: SourceDocumentPresentation
  /** User opt-out for this query session. Drives excludeDocumentIds. */
  readonly excludedFromQuery?: boolean
}
