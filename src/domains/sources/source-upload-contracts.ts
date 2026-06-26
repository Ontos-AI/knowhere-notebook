import type { Job } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

export type UploadJobResult = {
  readonly documentId?: string | null
}

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
    documentId?: string,
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
            documentMetadata?: Readonly<Record<string, unknown>>
          }
        | {
            sourceType: "url"
            sourceUrl: string
            fileName: string
            namespace: string
            documentMetadata?: Readonly<Record<string, unknown>>
          },
    ): Promise<Job>
    get(jobId: string): Promise<UploadJobResult>
    upload(job: string | Job, input: { file: string }): Promise<void>
  }
}

export type UploadSourceDependencies = {
  repository: UploadSourceRepository
  knowhere: UploadKnowhereClient
}
