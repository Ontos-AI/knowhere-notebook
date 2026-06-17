"use client"

import { useEffect } from "react"

import { sourceOriginalPreviewModel } from "@/components/source-original-preview-model"
import { sourceOriginalPreviewRequest } from "@/components/source-original-preview-request"
import type { SourceOriginalFileView } from "@/domains/sources/types"

type SourceOriginalPreviewWarmupInput = {
  readonly sourceTitle: string | null
  readonly file: SourceOriginalFileView | null
}

export function useSourceOriginalPreviewWarmup({
  sourceTitle,
  file,
}: SourceOriginalPreviewWarmupInput): void {
  const fileMimeType = file?.mimeType
  const filePdfPreviewMode = file?.pdfPreviewMode
  const fileSizeBytes = file?.sizeBytes
  const fileUrl = file?.url

  useEffect(() => {
    if (!fileUrl || !fileMimeType || !sourceTitle) return

    const previewFile: SourceOriginalFileView = {
      url: fileUrl,
      mimeType: fileMimeType,
      sizeBytes: fileSizeBytes,
      ...(filePdfPreviewMode ? { pdfPreviewMode: filePdfPreviewMode } : {}),
    }

    const kind = sourceOriginalPreviewModel.getPreviewKind(
      sourceTitle,
      fileMimeType,
    )
    if (
      !sourceOriginalPreviewModel.isWithinPreviewByteLimit(kind, previewFile)
    ) {
      return
    }

    const controller = new AbortController()

    if (kind === "pdf" && previewFile.pdfPreviewMode !== "browser") {
      sourceOriginalPreviewRequest.prefetchArrayBuffer(
        fileUrl,
        controller.signal,
      )
    } else if (kind === "docx") {
      sourceOriginalPreviewRequest.prefetchArrayBuffer(
        fileUrl,
        controller.signal,
      )
    } else if (kind === "text" || kind === "markdown") {
      sourceOriginalPreviewRequest.prefetchText(fileUrl, controller.signal)
    }

    return () => {
      controller.abort()
    }
  }, [fileMimeType, filePdfPreviewMode, fileSizeBytes, fileUrl, sourceTitle])
}
