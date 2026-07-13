import packageJson from "../../../package.json";

/**
 * Official notebook client identity for job `document_metadata`.
 * Caller overrides win; defaults fill missing keys only when merged.
 */
export const NOTEBOOK_DOCUMENT_METADATA_DEFAULTS = {
  createdByClient: "notebook",
  clientVersion: packageJson.version,
} as const;

export function createNotebookDocumentMetadata(input: {
  readonly title: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly overrides?: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  return {
    ...NOTEBOOK_DOCUMENT_METADATA_DEFAULTS,
    sourceFileName: input.title,
    title: input.title,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    ...input.overrides,
  };
}
