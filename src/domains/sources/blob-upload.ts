import {
  FILE_TOO_LARGE_MESSAGE,
  MAX_UPLOAD_BYTES,
  validateUploadFile,
  type UploadValidationResult,
} from "./validation";

export const SOURCE_UPLOAD_BLOB_HANDLE_PATH = "/api/source-uploads/blob";
export const SOURCE_UPLOAD_BLOB_PREFIX = "source-uploads";

export type SourceBlobUploadInput = {
  readonly pathname: string;
  readonly url: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

export type SourceBlobUploadMetadata = Omit<
  SourceBlobUploadInput,
  "pathname" | "url"
>;

export function getSourceUploadBlobPathname(file: File): string {
  const validation = validateUploadFile(file);
  const extension = validation.ok ? validation.extension : "bin";
  const uploadId = getUploadId();
  return `${SOURCE_UPLOAD_BLOB_PREFIX}/${uploadId}/document.${extension}`;
}

export function createSourceBlobUploadInput(
  file: File,
  pathname: string,
  url: string,
): SourceBlobUploadInput | { readonly message: string } {
  const validation = validateUploadFile(file);
  if (!validation.ok) {
    return { message: validation.message };
  }

  return {
    pathname,
    url,
    fileName: validation.title,
    mimeType: validation.mimeType,
    sizeBytes: file.size,
  };
}

export function parseSourceBlobUploadBody(
  body: unknown,
): SourceBlobUploadInput | null {
  if (!isRecord(body)) return null;
  const upload = body.upload;
  if (!isRecord(upload) || upload.type !== "blob") return null;

  const { pathname, url, fileName, mimeType, sizeBytes } = upload;
  if (
    typeof pathname !== "string" ||
    typeof url !== "string" ||
    typeof fileName !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return null;
  }

  return { pathname, url, fileName, mimeType, sizeBytes };
}

export function parseSourceBlobClientPayload(
  payload: string | null,
): SourceBlobUploadMetadata | null {
  if (!payload) return null;

  try {
    const body = JSON.parse(payload) as unknown;
    if (!isRecord(body)) return null;
    const { fileName, mimeType, sizeBytes } = body;
    if (
      typeof fileName !== "string" ||
      typeof mimeType !== "string" ||
      typeof sizeBytes !== "number" ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes <= 0
    ) {
      return null;
    }

    return { fileName, mimeType, sizeBytes };
  } catch {
    return null;
  }
}

export function validateSourceBlobUploadInput(
  input: SourceBlobUploadInput,
): UploadValidationResult {
  const validation = validateSourceBlobUploadMetadata(input);
  if (!validation.ok) return validation;

  if (!isValidPublicSourceBlobUrl(input.url, input.pathname)) {
    return {
      ok: false,
      message: "Invalid upload URL. Choose the document again.",
    };
  }

  return validation;
}

export function validateSourceBlobUploadMetadata(
  input: SourceBlobUploadMetadata & { readonly pathname: string },
): UploadValidationResult {
  if (!isValidSourceBlobPathname(input.pathname)) {
    return {
      ok: false,
      message: "Invalid upload path. Choose the document again.",
    };
  }

  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: FILE_TOO_LARGE_MESSAGE,
    };
  }

  return validateUploadFile({
    name: input.fileName,
    type: input.mimeType,
    size: input.sizeBytes,
  });
}

export function isValidPublicSourceBlobUrl(
  url: string,
  pathname: string,
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (!parsed.hostname.endsWith(".public.blob.vercel-storage.com")) {
      return false;
    }

    const normalizedPathname = parsed.pathname.replace(/^\/+/, "");
    return normalizedPathname === pathname;
  } catch {
    return false;
  }
}

export function isValidSourceBlobPathname(pathname: string): boolean {
  if (!pathname.startsWith(`${SOURCE_UPLOAD_BLOB_PREFIX}/`)) return false;
  if (pathname.includes("\0")) return false;

  const parts = pathname.split("/");
  if (parts.length !== 3) return false;
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function getUploadId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return randomUUID.call(globalThis.crypto);
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
