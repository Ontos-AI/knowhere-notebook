import { Effect } from "effect"

import type { Source } from "@/infrastructure/db/schema"
import type { SourceView } from "./types"
import {
  createRemoteSourceId,
  getCompatibleNamespaces,
  sharedLibraryNamespace,
} from "./namespace"

type RemoteDocument = {
  readonly documentId: string
  readonly namespace: string
  readonly status: string
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

export type RemoteLibraryProjection = {
  readonly sourceViews: readonly SourceView[]
  readonly sources: readonly Source[]
}

export type RemoteLibrarySource = Source & {
  readonly namespace: string
}

export function listRemoteLibrarySourceViews(
  input: RemoteLibraryProjectionInput,
): Effect.Effect<RemoteLibraryProjection, never> {
  return Effect.gen(function* () {
    const localDocumentIds = new Set(
      input.localSources
        .map((source) => source.knowhereDocumentId)
        .filter((documentId): documentId is string => Boolean(documentId)),
    )
    const seenDocumentIds = new Set(localDocumentIds)
    const sourceViews: SourceView[] = []
    const sources: Source[] = []

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
        if (!document || document.status === "archived") continue
        if (seenDocumentIds.has(document.documentId)) continue

        seenDocumentIds.add(document.documentId)
        sourceViews.push(toRemoteSourceView(document))
        sources.push(toRemoteSource(document))
      }
    }

    return { sourceViews, sources }
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
  const documentMetadata = getRecord(
    raw.documentMetadata ?? raw.document_metadata,
  )

  return {
    documentId,
    namespace,
    status,
    sourceFileName,
    documentMetadata,
  }
}

function toRemoteSourceView(document: RemoteDocument): SourceView {
  return {
    id: createRemoteSourceId({
      namespace: document.namespace,
      documentId: document.documentId,
    }),
    kind: "workspace",
    namespace: document.namespace,
    title: getRemoteDocumentTitle(document),
    mimeType: getRemoteDocumentMimeType(document),
    status: getRemoteSourceStatus(document),
    documentId: document.documentId,
  }
}

export function createRemoteSource(input: {
  readonly documentId: string
  readonly namespace: string
  readonly title?: string | null
  readonly mimeType?: string | null
}): RemoteLibrarySource {
  return toRemoteSource({
    documentId: input.documentId,
    namespace: input.namespace,
    status: "active",
    sourceFileName: input.title,
    documentMetadata: input.mimeType ? { mimeType: input.mimeType } : {},
  })
}

export function toRemoteSource(document: RemoteDocument): RemoteLibrarySource {
  const now = new Date(0)
  return {
    id: createRemoteSourceId({
      namespace: document.namespace,
      documentId: document.documentId,
    }),
    workspaceId: "remote",
    title: getRemoteDocumentTitle(document),
    mimeType: getRemoteDocumentMimeType(document),
    sizeBytes: getRemoteDocumentSizeBytes(document),
    status: getRemoteSourceStatus(document),
    failureReason: null,
    knowhereJobId: null,
    knowhereDocumentId: document.documentId,
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    namespace: document.namespace,
  } as RemoteLibrarySource
}

function getRemoteSourceStatus(document: RemoteDocument): SourceView["status"] {
  if (isActiveDocumentStatus(document.status)) return "ready"
  if (document.status === "failed") return "failed"
  return "parsing"
}

function isActiveDocumentStatus(status: string): boolean {
  return status === "active" || status === "ready" || status === "done"
}

function getRemoteDocumentTitle(document: RemoteDocument): string {
  return (
    getString(document.documentMetadata?.["source_file_name"]) ??
    getString(document.documentMetadata?.["title"]) ??
    document.sourceFileName ??
    document.documentId
  )
}

function getRemoteDocumentMimeType(document: RemoteDocument): string {
  return (
    getString(document.documentMetadata?.["mime_type"]) ??
    getString(document.documentMetadata?.["mimeType"]) ??
    "application/octet-stream"
  )
}

function getRemoteDocumentSizeBytes(document: RemoteDocument): number {
  const value =
    getNumber(document.documentMetadata?.["size_bytes"]) ??
    getNumber(document.documentMetadata?.["sizeBytes"])
  return value ?? 0
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
