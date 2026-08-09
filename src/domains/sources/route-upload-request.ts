import {
  parseSourceBlobUploadBody,
  type SourceBlobUploadInput,
} from "./blob-upload"

type SourceUploadRequest =
  | {
      readonly type: "file"
      readonly file: File
    }
  | {
      readonly type: "blob"
      readonly input: SourceBlobUploadInput
    }
  | {
      readonly type: "error"
      readonly message: string
    }

type SourceRouteUploadRequestInput = {
  readonly workspaceId?: string
}

type SourceRouteUploadRequestModule = {
  readonly read: (
    request: Request,
  ) => Promise<SourceUploadRequest & SourceRouteUploadRequestInput>
}

async function read(
  request: Request,
): Promise<SourceUploadRequest & SourceRouteUploadRequestInput> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return readBlobBackedUpload(request)
  }

  return readMultipartFileUpload(request)
}

async function readBlobBackedUpload(
  request: Request,
): Promise<SourceUploadRequest & SourceRouteUploadRequestInput> {
  const body = (await request.json()) as Record<string, unknown>
  const input = parseSourceBlobUploadBody(body)
  if (!input) return missingUpload()

  const workspaceId =
    typeof body.workspaceId === "string" && body.workspaceId.length > 0
      ? body.workspaceId
      : undefined

  return { type: "blob", input, workspaceId }
}

async function readMultipartFileUpload(
  request: Request,
): Promise<SourceUploadRequest & SourceRouteUploadRequestInput> {
  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return missingUpload()

  const workspaceIdValue = formData.get("workspaceId")
  const workspaceId =
    typeof workspaceIdValue === "string" && workspaceIdValue.length > 0
      ? workspaceIdValue
      : undefined

  return { type: "file", file, workspaceId }
}

function missingUpload(): SourceUploadRequest & SourceRouteUploadRequestInput {
  return {
    type: "error",
    message: "Choose a document to upload.",
  }
}

export const sourceRouteUploadRequest: SourceRouteUploadRequestModule = {
  read,
}
