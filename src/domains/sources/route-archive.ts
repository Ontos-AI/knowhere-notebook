import { Effect } from "effect"

import { routeResult } from "@/lib/route-result"
import { getClientForWorkspace } from "./route-dependencies"
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

    if (!source) {
      const catalog = yield* Effect.tryPromise(() => deps.demoApi.fetchCatalog())
      const isDemoSource = catalog.sources.some(
        (candidate) => candidate.demoSourceId === input.sourceId,
      )
      if (isDemoSource) {
        yield* Effect.tryPromise(() =>
          deps.sourceService.hideDemoSource(workspace.id, input.sourceId),
        )
        return routeResult.ok({ id: input.sourceId, archived: true as const })
      }

      return routeResult.error(404, "Source not found.")
    }

    if (source.knowhereDocumentId) {
      const client = yield* Effect.tryPromise(() =>
        getClientForWorkspace(workspace.id, input.cookieHeader, deps),
      )
      yield* Effect.tryPromise(() =>
        client.documents.archive(source.knowhereDocumentId!),
      ).pipe(
        Effect.catchIf(isKnowhereDocumentNotFoundError, () => Effect.void),
      )
    }

    yield* Effect.tryPromise(() =>
      deps.sourceService.softDelete(workspace.id, input.sourceId),
    )
    if (source.demoKey) {
      yield* Effect.tryPromise(() =>
        deps.sourceService.hideDemoSource(workspace.id, source.demoKey!),
      )
    }
    if (source.originalBlobPathname) {
      yield* Effect.tryPromise(() =>
        deps.deleteBlob(source.originalBlobPathname!),
      ).pipe(Effect.catchAllCause(() => Effect.void))
    }

    return routeResult.ok({ id: input.sourceId, archived: true as const })
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
