import type { Job } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

export type UploadSourceRepository = {
  createUploadingSource(
    workspaceId: string,
    input: {
      title: string
      mimeType: string
      sizeBytes: number
      stagedBlobPathname?: string | null
      stagedBlobUrl?: string | null
      originalBlobPathname?: string | null
      originalBlobUrl?: string | null
    },
  ): Promise<Source>
  markSourceParsing(
    workspaceId: string,
    sourceId: string,
    jobId: string,
  ): Promise<Source>
  markSourceFailed(
    workspaceId: string,
    sourceId: string,
    reason: string,
  ): Promise<Source>
}

export type UploadKnowhereClient = {
  jobs: {
    create(
      input:
        | {
            sourceType: "file"
            fileName: string
            namespace: string
          }
        | {
            sourceType: "url"
            sourceUrl: string
            fileName: string
            namespace: string
          },
    ): Promise<Job>
    upload(job: string | Job, input: { file: string }): Promise<void>
  }
}

export type UploadSourceDependencies = {
  repository: UploadSourceRepository
  knowhere: UploadKnowhereClient
}
