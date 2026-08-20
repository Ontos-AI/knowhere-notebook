import packageJson from "../../../package.json";

/**
 * Official notebook client identity for job `document_metadata`.
 * Caller overrides win; defaults fill missing keys only when merged.
 */
export const NOTEBOOK_DOCUMENT_METADATA_DEFAULTS = {
  createdByClient: "notebook",
  clientVersion: packageJson.version,
} as const;

export const NOTEBOOK_VISIBLE_CREATED_BY_CLIENTS = [
  "notebook",
  "cli",
  "mcp",
] as const;

export type NotebookVisibleCreatedByClient =
  (typeof NOTEBOOK_VISIBLE_CREATED_BY_CLIENTS)[number];

const notebookVisibleCreatedByClientSet = new Set<string>(
  NOTEBOOK_VISIBLE_CREATED_BY_CLIENTS,
);

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

export function getCreatedByClient(
  metadata: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (!metadata) return undefined;
  const value = metadata.createdByClient ?? metadata.created_by_client;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isNotebookVisibleRemoteClient(
  client: string | undefined,
): client is NotebookVisibleCreatedByClient {
  return (
    client !== undefined && notebookVisibleCreatedByClientSet.has(client)
  );
}

export function isNotebookVisibleRemoteMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return isNotebookVisibleRemoteClient(getCreatedByClient(metadata));
}
