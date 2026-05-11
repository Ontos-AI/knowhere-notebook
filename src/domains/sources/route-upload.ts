import type { Source, Workspace } from "@/infrastructure/db/schema"
import { routeResult } from "@/lib/route-result"
import { validateSourceBlobUploadInput } from "./blob-upload"
import { getClientForWorkspace } from "./route-dependencies"
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
    uploadSource: (input: UploadSourceInput) => uploadSource(input, deps),
  }
}

async function uploadSource(
  input: UploadSourceInput,
  deps: RouteUploadDependencies,
): Promise<JsonRouteResult<UploadSourceBody>> {
  const user = await deps.getCurrentUser()
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

  const workspace = await deps.ensureWorkspace(user.id)
  const client = await getClientForWorkspace(
    workspace.id,
    input.cookieHeader,
    deps,
  )
  const source = await uploadToKnowhere(workspace, input.upload, client, deps)
    .finally(() => {
      input.onUploadFinished?.()
    })

  return routeResult.ok({ source: toSourceView(source) }, 201)
}

async function uploadToKnowhere(
  workspace: Workspace,
  upload: Exclude<SourceUploadRequest, { readonly type: "error" }>,
  client: SourceRouteKnowhereClient,
  deps: RouteUploadDependencies,
): Promise<Source> {
  return upload.type === "file"
    ? deps.sourceService.uploadSourceToKnowhere(workspace, upload.file, client)
    : deps.sourceService.uploadSourceBlobToKnowhere(
        workspace,
        upload.input,
        client,
      )
}

export { createRouteUpload }
