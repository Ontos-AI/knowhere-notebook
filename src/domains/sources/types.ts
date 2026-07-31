export type SourceStatus = "uploading" | "parsing" | "ready" | "failed"

export type SourceOriginalFileView = {
  readonly url: string
  readonly mimeType: string
  readonly sizeBytes?: number
  readonly canDownload?: boolean
  readonly pdfPreviewMode?: "browser"
}

export type SourceKind = "workspace" | "remote"

/**
 * Sources sidebar row. Metadata-only, per the MVP persistence rule.
 */
export type SourceView = {
  readonly id: string
  readonly kind?: SourceKind
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
  /** Count from the Knowhere chunks API, not a local aggregate. */
  readonly chunkCount?: number
  /** User opt-out for this query session. Drives excludeDocumentIds. */
  readonly excludedFromQuery?: boolean
}
