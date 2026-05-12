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

type SourceRouteUploadRequestModule = {
  readonly read: (request: Request) => Promise<SourceUploadRequest>
}

async function read(request: Request): Promise<SourceUploadRequest> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return readBlobBackedUpload(request)
  }

  return readMultipartFileUpload(request)
}

async function readBlobBackedUpload(
  request: Request,
): Promise<SourceUploadRequest> {
  const body = (await request.json()) as unknown
  const input = parseSourceBlobUploadBody(body)
  if (!input) return missingUpload()

  return { type: "blob", input }
}

async function readMultipartFileUpload(
  request: Request,
): Promise<SourceUploadRequest> {
  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return missingUpload()

  return { type: "file", file }
}

function missingUpload(): SourceUploadRequest {
  return {
    type: "error",
    message: "Choose a document to upload.",
  }
}

export const sourceRouteUploadRequest: SourceRouteUploadRequestModule = {
  read,
}
