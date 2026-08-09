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
    if (!workspace) {
      return routeResult.badRequest(
        "No workspace yet — pick a namespace from the dropdown.",
      )
    }

    const source = yield* Effect.tryPromise(() =>
      deps.sourceService.findInWorkspace(workspace.id, input.sourceId),
    )

    if (!source) {
      return routeResult.error(404, "Source not found.")
    }

    if (source.knowhereDocumentId) {
      const client = yield* Effect.tryPromise(() =>
        getClientForWorkspace(workspace.id, input.cookieHeader, deps),
      )
      yield* Effect.tryPromise(() =>
        client.documents.archive(source.knowhereDocumentId!),
      )
    }

    yield* Effect.tryPromise(() =>
      deps.sourceService.softDelete(workspace.id, input.sourceId),
    )
    if (source.originalBlobPathname) {
      yield* Effect.tryPromise(() =>
        deps.deleteBlob(source.originalBlobPathname!),
      ).pipe(Effect.catchAllCause(() => Effect.void))
    }

    return routeResult.ok({ id: input.sourceId, archived: true as const })
  })

export { createRouteArchive }
