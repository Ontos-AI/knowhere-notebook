import type { ChatCitationView } from "@/domains/chat/types";

export const chatPanelModel = {
  formatThreadDate,
  getCitationId,
  getCitationLabel,
} as const;

function formatThreadDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated recently";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getCitationId(messageId: string, citationIndex: number): string {
  return `${messageId}:${citationIndex}`;
}

function getCitationLabel(
  citation: ChatCitationView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): string {
  const sourceName = getCitationSourceName(citation, sourceTitlesByDocumentId);
  const detail = getCitationDetail(citation, sourceName);
  const parts = [sourceName ?? "Source", detail].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  return Array.from(new Set(parts)).join(" · ");
}

function getCitationSourceName(
  citation: ChatCitationView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): string | undefined {
  const documentId = citation.source.documentId;
  const title = documentId ? sourceTitlesByDocumentId[documentId] : undefined;
  if (title) return title;

  return normalizeCitationLabelPart(citation.source.sourceFileName);
}

function getCitationDetail(
  citation: ChatCitationView,
  sourceName: string | undefined,
): string | undefined {
  const rawSourceName = citation.source.sourceFileName;
  const detail = normalizeCitationLabelPart(citation.description, sourceName);
  if (detail && detail !== rawSourceName) return detail;

  return normalizeCitationLabelPart(citation.source.sectionPath, sourceName);
}

function normalizeCitationLabelPart(
  value: string | null | undefined,
  sourceName?: string,
): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === sourceName) return undefined;
  if (trimmed === "Root") return undefined;
  if (isGeneratedKnowhereFileName(trimmed)) return undefined;

  const normalized = trimmed
    .replace(/^Default_Root\//, "")
    .replace(/^Root\//, "")
    .replace(/^[^/]+\.[A-Za-z0-9]+-->/, "")
    .trim();

  return normalized.length > 0 ? normalized : undefined;
}

function isGeneratedKnowhereFileName(value: string): boolean {
  return /^document-[A-Za-z0-9_-]{16,}\.[A-Za-z0-9]+$/u.test(value);
}
