import {
  createSourceBlobUploadInput,
  type SourceBlobUploadInput,
} from "./blob-upload"
import { validateUploadFile } from "./validation"
import type { SourceView } from "@/domains/sources/types"

type SourceUploadResponseBody = {
  readonly message?: string
  readonly source?: SourceView
}

type SourceUploadResponse = {
  readonly status: number
  readonly body: SourceUploadResponseBody
}

type StagedBlob = {
  readonly pathname: string
  readonly url: string
}

type UploadStagedBlobInput = {
  readonly file: File
  readonly fileName: string
  readonly mimeType: string
  readonly pathname: string
  readonly sizeBytes: number
}

type StagedUploadWorkflowDependencies = {
  readonly cleanupBlob: (pathname: string) => Promise<void>
  readonly getPathname: (file: File) => string
  readonly postMetadata: (
    input: SourceBlobUploadInput,
  ) => Promise<SourceUploadResponse>
  readonly uploadBlob: (input: UploadStagedBlobInput) => Promise<StagedBlob>
}

type StagedUploadWorkflow = {
  readonly upload: (
    file: File,
    deps: StagedUploadWorkflowDependencies,
  ) => Promise<SourceUploadResponse>
}

async function upload(
  file: File,
  deps: StagedUploadWorkflowDependencies,
): Promise<SourceUploadResponse> {
  const validation = validateUploadFile(file)
  if (!validation.ok) {
    return {
      status: 400,
      body: { message: validation.message },
    }
  }

  const stagedBlob = await deps.uploadBlob({
    file,
    fileName: validation.title,
    mimeType: validation.mimeType,
    pathname: deps.getPathname(file),
    sizeBytes: file.size,
  })
  const metadataInput = createSourceBlobUploadInput(
    file,
    stagedBlob.pathname,
    stagedBlob.url,
  )
  if ("message" in metadataInput) {
    await deps.cleanupBlob(stagedBlob.pathname)
    return {
      status: 400,
      body: { message: metadataInput.message },
    }
  }

  try {
    const response = await deps.postMetadata(metadataInput)
    if (!isSuccessfulStatus(response.status)) {
      await deps.cleanupBlob(stagedBlob.pathname)
    }
    return response
  } catch (error) {
    await deps.cleanupBlob(stagedBlob.pathname)
    throw error
  }
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300
}

export const stagedUploadWorkflow: StagedUploadWorkflow = {
  upload,
}
