import { Effect } from "effect"

import type { Source } from "@/infrastructure/db/schema"
import type { SourceStatus } from "./types"
import { getCompatibleNamespaces, sharedLibraryNamespace } from "./namespace"

type RemoteDocument = {
  readonly documentId: string
  readonly namespace: string
  readonly status: SourceStatus
  readonly title?: string
  readonly mimeType?: string
  readonly sizeBytes?: number
  readonly sourceFileName?: string | null
  readonly documentMetadata?: Record<string, unknown>
}

type RemoteDocumentCandidate = RemoteDocument | {
  readonly documentId?: string | null
  readonly namespace?: string | null
  readonly status?: string | null
  readonly sourceFileName?: string | null
  readonly documentMetadata?: Record<string, unknown>
}

type RemoteDocumentListResponse = {
  readonly documents: readonly RemoteDocumentCandidate[]
}

type RemoteDocumentClient = {
  readonly documents?: {
    readonly list?: (params?: {
      readonly namespace?: string
    }) => Promise<RemoteDocumentListResponse>
  }
}

type RemoteLibraryWorkspace = {
  readonly namespace: string
}

type RemoteLibraryProjectionInput = {
  readonly workspace: RemoteLibraryWorkspace
  readonly client: RemoteDocumentClient
  readonly localSources: readonly Source[]
}

type RemoteLibraryLocalizationInput = RemoteLibraryProjectionInput & {
  readonly localizeDocument: (
    document: RemoteDocument,
  ) => Promise<Source>
}

type RemoteDocumentRaw = {
  readonly document_id?: unknown
  readonly documentId?: unknown
  readonly namespace?: unknown
  readonly status?: unknown
  readonly source_file_name?: unknown
  readonly sourceFileName?: unknown
  readonly document_metadata?: unknown
  readonly documentMetadata?: unknown
}

export type RemoteLibraryDocument = RemoteDocument

export function listRemoteLibraryDocuments(
  input: RemoteLibraryProjectionInput,
): Effect.Effect<readonly RemoteLibraryDocument[], never> {
  return Effect.gen(function* () {
    const seenDocumentIds = new Set<string>()
    const documents: RemoteLibraryDocument[] = []

    for (const namespace of getCompatibleNamespaces(input.workspace)) {
      if (!input.client.documents?.list) continue
      const response = yield* Effect.tryPromise(() =>
        input.client.documents?.list?.({
          namespace,
        }) ??
        Promise.resolve({ documents: [] }),
      ).pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            documents: [],
          } satisfies RemoteDocumentListResponse),
        ),
      )

      for (const rawDocument of response.documents ?? []) {
        const document = normalizeRemoteDocument(rawDocument)
        if (!document) continue
        if (seenDocumentIds.has(document.documentId)) continue

        seenDocumentIds.add(document.documentId)
        documents.push(document)
      }
    }

    return documents
  })
}

export function localizeRemoteLibrarySources(
  input: RemoteLibraryLocalizationInput,
): Effect.Effect<readonly Source[], never> {
  return Effect.gen(function* () {
    const remoteDocuments = (yield* listRemoteLibraryDocuments(input)).filter(
      (document) =>
        !matchesActiveNotebookParsingSource(document, input.localSources),
    )
    if (remoteDocuments.length === 0) return input.localSources

    const localizedSources = yield* Effect.all(
      remoteDocuments.map((document) =>
        Effect.tryPromise(() => input.localizeDocument(document)).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        ),
      ),
      { concurrency: 4 },
    )

    return mergeLocalizedSources({
      localSources: input.localSources,
      localizedSources: localizedSources.filter(
        (source): source is Source => source !== null,
      ),
    })
  })
}

function normalizeRemoteDocument(
  value: RemoteDocumentCandidate | RemoteDocumentRaw,
): RemoteDocument | null {
  const raw = value as RemoteDocumentRaw
  const documentId = getString(raw.documentId ?? raw.document_id)
  if (!documentId) return null

  const namespace =
    getString(raw.namespace) ?? sharedLibraryNamespace
  const sourceFileName = getString(
    raw.sourceFileName ?? raw.source_file_name,
  )
  const status = getString(raw.status) ?? "ready"
  if (status === "archived") return null

  const documentMetadata = getRecord(
    raw.documentMetadata ?? raw.document_metadata,
  )

  const title = getRemoteDocumentTitle({
    documentId,
    sourceFileName,
    documentMetadata,
  })
  const mimeType = getRemoteDocumentMimeType({ documentMetadata })
  const sizeBytes = getRemoteDocumentSizeBytes({ documentMetadata })

  return {
    documentId,
    namespace,
    status: getRemoteSourceStatus(status),
    ...(title ? { title } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    sourceFileName,
    documentMetadata,
  }
}

function getRemoteSourceStatus(status: string): SourceStatus {
  if (isActiveDocumentStatus(status)) return "ready"
  if (status === "failed") return "failed"
  return "parsing"
}

function matchesActiveNotebookParsingSource(
  document: RemoteDocument,
  localSources: readonly Source[],
): boolean {
  if (document.documentMetadata?.createdByClient !== "notebook") return false
  if (!document.title || !document.mimeType || document.sizeBytes === undefined) {
    return false
  }

  return localSources.some(
    (source) =>
      source.status === "parsing" &&
      Boolean(source.knowhereJobId) &&
      !source.knowhereDocumentId &&
      source.title === document.title &&
      source.mimeType === document.mimeType &&
      source.sizeBytes === document.sizeBytes,
  )
}

function isActiveDocumentStatus(status: string): boolean {
  return status === "active" || status === "ready" || status === "done"
}

function getRemoteDocumentTitle(document: Pick<
  RemoteDocument,
  "documentId" | "documentMetadata" | "sourceFileName"
>): string | undefined {
  return (
    getString(document.documentMetadata?.["source_file_name"]) ??
    getString(document.documentMetadata?.["title"]) ??
    document.sourceFileName ??
    undefined
  )
}

function getRemoteDocumentMimeType(document: Pick<
  RemoteDocument,
  "documentMetadata"
>): string | undefined {
  return (
    getString(document.documentMetadata?.["mime_type"]) ??
    getString(document.documentMetadata?.["mimeType"])
  )
}

function getRemoteDocumentSizeBytes(document: Pick<
  RemoteDocument,
  "documentMetadata"
>): number | undefined {
  const value =
    getNumber(document.documentMetadata?.["size_bytes"]) ??
    getNumber(document.documentMetadata?.["sizeBytes"])
  return value
}

function mergeLocalizedSources(input: {
  readonly localSources: readonly Source[]
  readonly localizedSources: readonly Source[]
}): readonly Source[] {
  const localizedSourceByDocumentId = new Map(
    input.localizedSources.flatMap((source): readonly [string, Source][] => {
      const documentId = source.knowhereDocumentId
      return documentId ? [[documentId, source]] : []
    }),
  )
  const mergedDocumentIds = new Set<string>()
  const mergedSources: Source[] = []

  for (const source of input.localSources) {
    const documentId = source.knowhereDocumentId
    if (documentId) {
      const localizedSource = localizedSourceByDocumentId.get(documentId)
      mergedSources.push(localizedSource ?? source)
      mergedDocumentIds.add(documentId)
      continue
    }

    mergedSources.push(source)
  }

  for (const source of input.localizedSources) {
    const documentId = source.knowhereDocumentId
    if (documentId && mergedDocumentIds.has(documentId)) continue
    if (documentId) mergedDocumentIds.add(documentId)
    mergedSources.push(source)
  }

  return mergedSources
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function getRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
