import type { SourceOriginalFileView } from "@/domains/sources/types";

type PreviewKind =
  | "pdf"
  | "image"
  | "text"
  | "markdown"
  | "docx"
  | "unsupported";

const pdfPageAspectRatio = 1.414;
const pdfPageMaxWidth = 1600;
const pdfCanvasMaxDevicePixelRatio = 1.5;
const textPreviewByteLimit = 1024 * 1024;
const docxPreviewByteLimit = 10 * 1024 * 1024;

export const sourceOriginalPreviewModel = {
  canPreviewOriginalFile,
  pdfPageAspectRatio,
  getInitialPdfPageWidth,
  getBrowserPdfPreviewUrl,
  getOriginalDownloadUrl,
  getPdfCanvasDevicePixelRatio,
  getPdfPageAspectRatio,
  getPdfPagePlaceholderHeight,
  getPdfPageWidth,
  getPreviewKind,
  getPreviewLabel,
  getSafePdfPageAspectRatio,
  isWithinPreviewByteLimit,
  normalizeMarkdownPreviewText,
} as const;

function canPreviewOriginalFile(
  sourceTitle: string | null | undefined,
  file: SourceOriginalFileView | null | undefined,
): boolean {
  if (!file) return false;

  const kind = getPreviewKind(sourceTitle ?? "", file.mimeType);
  if (kind === "unsupported") return false;

  return isWithinPreviewByteLimit(kind, file);
}

function getPreviewKind(title: string, mimeType: string): PreviewKind {
  const extension = getExtension(title);
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType === "application/pdf" || extension === "pdf") {
    return "pdf";
  }
  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }
  if (normalizedMimeType === "text/markdown" || extension === "md") {
    return "markdown";
  }
  if (normalizedMimeType.startsWith("text/") || extension === "txt") {
    return "text";
  }
  if (
    normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return "docx";
  }
  return "unsupported";
}

function getPreviewLabel(kind: PreviewKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "image":
      return "Image";
    case "markdown":
      return "Markdown";
    case "text":
      return "Text";
    case "docx":
      return "Word";
    case "unsupported":
      return "Download";
  }
}

function isWithinPreviewByteLimit(
  kind: PreviewKind,
  file: SourceOriginalFileView,
): boolean {
  if (file.sizeBytes === undefined) return true;
  if (kind === "text" || kind === "markdown") {
    return file.sizeBytes <= textPreviewByteLimit;
  }
  if (kind === "docx") {
    return file.sizeBytes <= docxPreviewByteLimit;
  }

  return true;
}

function normalizeMarkdownPreviewText(value: string): string {
  return value.replace(/(?:<br\s*\/?>|&lt;br\s*\/?&gt;)/gi, "\n");
}

function getPdfPageWidth(containerWidth: number): number {
  const horizontalPadding = 32;
  const availableWidth = Math.max(1, containerWidth - horizontalPadding);
  return Math.min(pdfPageMaxWidth, availableWidth);
}

function getPdfPagePlaceholderHeight(
  width: number,
  aspectRatio: number,
): number {
  return Math.round(width * aspectRatio);
}

function getPdfPageAspectRatio(
  pageAspectRatios: ReadonlyMap<number, number>,
  pageNumber: number,
): number {
  return pageAspectRatios.get(pageNumber) ?? pdfPageAspectRatio;
}

function getSafePdfPageAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return pdfPageAspectRatio;
  }
  if (width <= 0 || height <= 0) return pdfPageAspectRatio;
  return height / width;
}

function getInitialPdfPageWidth(): number {
  if (typeof window === "undefined") return 640;
  return Math.max(1, Math.min(640, window.innerWidth - 48));
}

function getBrowserPdfPreviewUrl(
  url: string,
  targetPageNumber: number | null,
): string {
  if (!targetPageNumber) return url;

  const [urlWithoutFragment] = url.split("#");
  return `${urlWithoutFragment}#page=${targetPageNumber}`;
}

function getPdfCanvasDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;

  const devicePixelRatio = window.devicePixelRatio;
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(pdfCanvasMaxDevicePixelRatio, Math.max(1, devicePixelRatio));
}

function getOriginalDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith(".blob.vercel-storage.com")) {
      parsed.searchParams.set("download", "1");
      return parsed.toString();
    }
  } catch {
    return url;
  }

  return url;
}

function getExtension(title: string): string | null {
  const index = title.lastIndexOf(".");
  if (index < 0 || index === title.length - 1) return null;
  return title.slice(index + 1).toLowerCase();
}
