import { Effect } from "effect"

import type { Source } from "@/infrastructure/db/schema"
import type { DemoCatalog } from "@/integrations/knowhere-demo"
import { routeResult } from "@/lib/route-result"
import { getClientForWorkspace } from "./route-dependencies"
import { decodeRemoteSourceId } from "./remote-library"
import type {
  ArchiveSourceBody,
  ArchiveSourceInput,
  JsonRouteResult,
  SourceRouteServiceDependencies,
} from "./route-types"

type RouteArchiveDependencies = Pick<
  SourceRouteServiceDependencies,
  | "deleteBlob"
  | "demoApi"
  | "ensureApiKeyForWorkspace"
  | "ensureWorkspace"
  | "makeKnowhereClient"
  | "requireUser"
  | "sourceService"
>

type RouteArchive = {
  readonly archiveSource: (
    input: ArchiveSourceInput,
  ) => Promise<JsonRouteResult<ArchiveSourceBody>>
}

function createRouteArchive(deps: RouteArchiveDependencies): RouteArchive {
  return {
    archiveSource: (input: ArchiveSourceInput) =>
      Effect.runPromise(archiveSourceEffect(input, deps)),
  }
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const archiveSourceEffect = (
  input: ArchiveSourceInput,
  deps: RouteArchiveDependencies,
) =>
  Effect.gen(function* () {
    const user = yield* Effect.tryPromise(() => deps.requireUser())
    const workspace = yield* Effect.tryPromise(() =>
      deps.ensureWorkspace(user.id),
    )

    const source = yield* Effect.tryPromise(() =>
      deps.sourceService.findInWorkspace(workspace.id, input.sourceId),
    )

    if (source?.demoKey) {
      yield* Effect.tryPromise(() => deps.sourceService.hideDemoSource(workspace.id, source.demoKey ?? ""))
      return routeResult.ok({ id: input.sourceId, archived: true as const })
    }

    const remoteSource = decodeRemoteSourceId(input.sourceId)
    const documentId: string | null | undefined = source?.knowhereDocumentId ?? remoteSource?.documentId
    const canReferenceSharedDemo: boolean =
      (!source && !remoteSource) ||
      remoteSource?.namespace === "__knowhere_demo__" ||
      documentId?.startsWith("ddoc_") === true ||
      documentId?.startsWith("demo-doc-") === true
    const catalog: DemoCatalog = canReferenceSharedDemo
      ? yield* Effect.tryPromise(() => deps.demoApi.fetchCatalog())
      : { sources: [], officialLibrary: { categories: [], sources: [] } }
    const sharedSource = catalog.sources.find((candidate) =>
      candidate.demoSourceId === input.sourceId ||
      candidate.canonicalDocumentId === source?.knowhereDocumentId ||
      candidate.canonicalDocumentId === remoteSource?.documentId,
    )
    if (sharedSource) {
      yield* Effect.tryPromise(() => deps.sourceService.hideDemoSource(workspace.id, sharedSource.demoSourceId))
      return routeResult.ok({ id: input.sourceId, archived: true as const })
    }
    if (remoteSource?.namespace === "__knowhere_demo__" || documentId?.startsWith("ddoc_") || documentId?.startsWith("demo-doc-")) {
      return routeResult.error(404, "Shared demo source not found.")
    }

    if (source) {
      if (source.knowhereDocumentId) {
        yield* archiveKnowhereDocument(
          workspace.id,
          input.cookieHeader,
          source.knowhereDocumentId,
          deps,
        )
      }

      yield* cleanupLocalSource(workspace.id, source, deps)
      return routeResult.ok({ id: input.sourceId, archived: true as const })
    }

    if (!remoteSource) {
      return routeResult.error(404, "Source not found.")
    }

    const localSource = yield* Effect.tryPromise(() =>
      deps.sourceService.findByKnowhereDocumentId(
        workspace.id,
        remoteSource.documentId,
      ),
    )
    if (localSource?.demoKey) {
      yield* Effect.tryPromise(() => deps.sourceService.hideDemoSource(workspace.id, localSource.demoKey ?? ""))
      return routeResult.ok({ id: input.sourceId, archived: true as const })
    }

    yield* archiveKnowhereDocument(
      workspace.id,
      input.cookieHeader,
      remoteSource.documentId,
      deps,
    )

    if (localSource) {
      yield* cleanupLocalSource(workspace.id, localSource, deps)
    }

    return routeResult.ok({ id: input.sourceId, archived: true as const })
  })

const archiveKnowhereDocument = (
  workspaceId: string,
  cookieHeader: string,
  documentId: string,
  deps: RouteArchiveDependencies,
) =>
  Effect.gen(function* () {
    const client = yield* Effect.tryPromise(() =>
      getClientForWorkspace(workspaceId, cookieHeader, deps),
    )
    yield* Effect.tryPromise(() => client.documents.archive(documentId)).pipe(
      Effect.catchIf(isKnowhereDocumentNotFoundError, () => Effect.void),
    )
  })

const cleanupLocalSource = (
  workspaceId: string,
  source: Source,
  deps: RouteArchiveDependencies,
) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise(() =>
      deps.sourceService.softDelete(workspaceId, source.id),
    )
    if (source.demoKey) {
      yield* Effect.tryPromise(() =>
        deps.sourceService.hideDemoSource(workspaceId, source.demoKey!),
      )
    }
    if (source.originalBlobPathname) {
      yield* Effect.tryPromise(() =>
        deps.deleteBlob(source.originalBlobPathname!),
      ).pipe(Effect.catchAllCause(() => Effect.void))
    }
  })

function isKnowhereDocumentNotFoundError(error: unknown): boolean {
  return readErrorMessages(error).some(isDocumentNotFoundMessage)
}

function readErrorMessages(error: unknown): readonly string[] {
  if (error instanceof Error) {
    return [
      error.message,
      ...readNestedErrorMessages(error),
    ].filter(isNonEmptyString)
  }

  if (typeof error === "string") return [error]

  if (!isRecord(error)) return []

  const messages: string[] = []
  if (typeof error.message === "string") messages.push(error.message)
  messages.push(...readNestedErrorMessages(error))
  return messages
}

function readNestedErrorMessages(error: unknown): readonly string[] {
  if (!isRecord(error)) return []

  const nested = [
    error.error,
    error.cause,
    isRecord(error.body) ? error.body.error : undefined,
  ]

  return nested.flatMap((value) =>
    value === undefined || value === error ? [] : readErrorMessages(value),
  )
}

function isDocumentNotFoundMessage(message: string): boolean {
  return /\bdocument\s+not\s+found\b/iu.test(message)
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export { createRouteArchive }
