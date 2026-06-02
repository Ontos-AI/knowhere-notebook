export const MAX_UPLOAD_MB = 300;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
export const SUPPORT_EMAIL = "team@knowhereto.ai";
export const KNOWHERE_ISSUES_URL = "https://github.com/Ontos-AI/knowhere/issues";
export const FILE_TOO_LARGE_MESSAGE =
  `File is too large. Upload a document up to ${MAX_UPLOAD_MB} MB. ` +
  `For larger files, contact ${SUPPORT_EMAIL} or open an issue at ${KNOWHERE_ISSUES_URL}.`;

const SUPPORTED_EXTENSIONS = new Set([
  "doc",
  "docx",
  "pdf",
  "xls",
  "xlsx",
  "pptx",
  "jpg",
  "jpeg",
  "png",
  "md",
  "txt",
]);

export type UploadFileInfo = {
  name: string;
  type: string;
  size: number;
};

export type UploadValidationResult =
  | {
      ok: true;
      extension: string;
      mimeType: string;
      title: string;
    }
  | {
      ok: false;
      message: string;
    };

export function validateUploadFile(file: UploadFileInfo): UploadValidationResult {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: FILE_TOO_LARGE_MESSAGE,
    };
  }

  const extension = getExtension(file.name);
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      message:
        "Unsupported file type. Upload a PDF, Word, PowerPoint, spreadsheet, image, text, or Markdown document.",
    };
  }

  return {
    ok: true,
    extension,
    mimeType: file.type || inferMimeType(extension),
    title: file.name,
  };
}

function getExtension(name: string): string | null {
  const index = name.lastIndexOf(".");
  if (index < 0 || index === name.length - 1) return null;
  return name.slice(index + 1).toLowerCase();
}

function inferMimeType(extension: string): string {
  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
