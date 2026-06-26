import type Knowhere from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

type KnowhereJobCreateInput = Parameters<Knowhere["jobs"]["create"]>[0] & {
  readonly documentMetadata?: Readonly<Record<string, unknown>>
}

export type UploadJobResult = Awaited<
  ReturnType<Knowhere["jobs"]["create"]>
> & {
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
    create(input: KnowhereJobCreateInput): Promise<UploadJobResult>
    get(jobId: string): Promise<UploadJobResult>
    upload(
      job: Parameters<Knowhere["jobs"]["upload"]>[0],
      input: { file: string },
    ): Promise<void>
  }
}

export type UploadSourceDependencies = {
  repository: UploadSourceRepository
  knowhere: UploadKnowhereClient
}
