export type SourceStatus = "uploading" | "parsing" | "ready" | "failed"

export type SourceOriginalFileView = {
  readonly url: string
  readonly mimeType: string
  readonly sizeBytes?: number
  readonly canDownload?: boolean
}

export type SourceKind = "workspace" | "demo"

export type SourceOfficialLibraryView = {
  readonly librarySourceId: string
  readonly categoryId: string
  readonly sourceUrl: string
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
  readonly title: string
  /** Browser-provided content type for preview routing. */
  readonly mimeType: string
  readonly status: SourceStatus
  /** Knowhere document ID once parsing publishes. */
  readonly documentId?: string
  /** Public Blob URL for original-file preview and download. */
  readonly originalFile?: SourceOriginalFileView
  /** Official Library metadata when this row is an API-owned catalog item. */
  readonly officialLibrary?: SourceOfficialLibraryView
  /** Count from the Knowhere chunks API, not a local aggregate. */
  readonly chunkCount?: number
  /** User opt-out for this query session. Drives excludeDocumentIds. */
  readonly excludedFromQuery?: boolean
}
