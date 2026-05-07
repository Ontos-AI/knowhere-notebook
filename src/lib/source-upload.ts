import "server-only"

import { Effect } from "effect"
import type { Job } from "@ontos-ai/knowhere-sdk"

import type { Source, Workspace } from "./schema"
import { validateUploadFile } from "./source-validation"
import { TempFile, tempFileLayer } from "./temp-files"

export type UploadSourceRepository = {
  createUploadingSource(
    workspaceId: string,
    input: {
      title: string
      mimeType: string
      sizeBytes: number
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
    create(input: {
      sourceType: "file"
      fileName: string
      namespace: string
    }): Promise<Job>
    upload(job: string | Job, input: { file: string }): Promise<void>
  }
}

export type TempFileStore = {
  write(file: File): Promise<{
    path: string
    cleanup(): Promise<void>
  }>
}

export type UploadSourceDependencies = {
  repository: UploadSourceRepository
  knowhere: UploadKnowhereClient
}

/**
 * Upload a file to Knowhere for parsing.
 *
 * Uses `Effect.scoped` + `TempFile.withFile` so the temp file is guaranteed
 * to be cleaned up even if the upload fails mid-flight.
 */
export async function uploadSourceToKnowhere(
  workspace: Workspace,
  file: File,
  deps: UploadSourceDependencies,
): Promise<Source> {
  const validation = validateUploadFile(file)
  if (!validation.ok) throw new Error(validation.message)

  const source = await deps.repository.createUploadingSource(workspace.id, {
    title: validation.title,
    mimeType: validation.mimeType,
    sizeBytes: file.size,
  })

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const temp = yield* TempFile
        const { path } = yield* temp.withFile(file)

        const job = yield* Effect.promise(() =>
          deps.knowhere.jobs.create({
            sourceType: "file",
            fileName: validation.title,
            namespace: workspace.namespace,
          }),
        )
        yield* Effect.promise(() =>
          deps.knowhere.jobs.upload(job, { file: path }),
        )

        return yield* Effect.promise(() =>
          deps.repository.markSourceParsing(
            workspace.id,
            source.id,
            job.jobId,
          ),
        )
      }),
    ).pipe(Effect.provide(tempFileLayer)),
  ).catch(async (err) => {
    const message = "Knowhere upload failed."
    await deps.repository.markSourceFailed(
      workspace.id,
      source.id,
      message,
    )
    throw new Error(message, { cause: err })
  })
}
