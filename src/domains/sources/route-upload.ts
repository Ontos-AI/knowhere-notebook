import { Effect } from "effect"

import type { Workspace } from "@/infrastructure/db/schema"
import { routeResult } from "@/lib/route-result"
import { startBackgroundReconciliation } from "./background-reconcile"
import { validateSourceBlobUploadInput } from "./blob-upload"
import type {
  JsonRouteResult,
  SourceRouteKnowhereClient,
  SourceRouteServiceDependencies,
  SourceUploadRequest,
  UploadSourceBody,
  UploadSourceInput,
} from "./route-types"
import { validateUploadFile } from "./validation"
import { toSourceView } from "./view"

type RouteUploadDependencies = Pick<
  SourceRouteServiceDependencies,
  | "ensureApiKeyForWorkspace"
  | "ensureWorkspace"
  | "findWorkspaceByIdAndUserId"
  | "getCurrentUser"
  | "makeKnowhereClient"
  | "sourceService"
>

type RouteUpload = {
  readonly uploadSource: (
    input: UploadSourceInput,
  ) => Promise<JsonRouteResult<UploadSourceBody>>
}

function createRouteUpload(deps: RouteUploadDependencies): RouteUpload {
  return {
    uploadSource: (input: UploadSourceInput) =>
      Effect.runPromise(uploadSourceEffect(input, deps)),
  }
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const uploadSourceEffect = (
  input: UploadSourceInput,
  deps: RouteUploadDependencies,
) =>
  Effect.gen(function* () {
    const user = yield* Effect.tryPromise(() => deps.getCurrentUser())
    if (!user) {
      return routeResult.error(401, "Please log in to upload documents.")
    }

    if (input.upload.type === "error") {
      return routeResult.badRequest(input.upload.message)
    }

    const validation =
      input.upload.type === "file"
        ? validateUploadFile(input.upload.file)
        : validateSourceBlobUploadInput(input.upload.input)
    if (!validation.ok) {
      return routeResult.badRequest(validation.message)
    }

    const workspace = yield* Effect.tryPromise(() =>
      input.workspaceId
        ? deps.findWorkspaceByIdAndUserId(input.workspaceId, user.id)
        : deps.ensureWorkspace(user.id),
    )
    if (!workspace) {
      return routeResult.badRequest(
        "No workspace yet — pick a namespace from the dropdown.",
      )
    }
    const apiKey = yield* Effect.tryPromise(() =>
      deps.ensureApiKeyForWorkspace(workspace.id),
    )
    const client = deps.makeKnowhereClient(apiKey)

    const source = yield* uploadToKnowhereEffect(
      workspace,
      input.upload,
      client,
      deps,
    ).pipe(
      Effect.onExit(() =>
        Effect.sync(() => {
          input.onUploadFinished?.()
        }),
      ),
    )

    if (source.status === "parsing") {
      yield* Effect.tryPromise(() =>
        startBackgroundReconciliation(workspace.id, source.id, apiKey),
      )
    }

    return routeResult.ok({ source: toSourceView(source) }, 201)
  })

const uploadToKnowhereEffect = (
  workspace: Workspace,
  upload: Exclude<SourceUploadRequest, { readonly type: "error" }>,
  client: SourceRouteKnowhereClient,
  deps: RouteUploadDependencies,
) =>
  upload.type === "file"
    ? Effect.tryPromise(() =>
        deps.sourceService.uploadSourceToKnowhere(workspace, upload.file, client),
      )
    : Effect.tryPromise(() =>
        deps.sourceService.uploadSourceBlobToKnowhere(
          workspace,
          upload.input,
          client,
        ),
      )

export { createRouteUpload }
