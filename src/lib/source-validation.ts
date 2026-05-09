export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "txt",
  "md",
  "ppt",
  "pptx",
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
      message: "File is too large. Upload a document up to 100 MB.",
    };
  }

  const extension = getExtension(file.name);
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      message:
        "Unsupported file type. Upload a PDF, Word, PowerPoint, text, or Markdown document.",
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
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return "application/octet-stream";
  }
}
