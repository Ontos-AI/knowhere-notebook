import "server-only"

import { del, get } from "@vercel/blob"
import { Effect } from "effect"
import type { Job } from "@ontos-ai/knowhere-sdk"

import type { Source, Workspace } from "./schema"
import {
  type SourceBlobUploadInput,
  validateSourceBlobUploadInput,
} from "./source-blob-upload"
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

export type UploadSourceBlobStore = {
  get(pathname: string): Promise<{
    statusCode: number
    stream: ReadableStream<Uint8Array> | null
    blob: {
      pathname: string
      contentType: string | null
      size: number | null
    }
  } | null>
  del(pathname: string): Promise<void>
}

export type UploadSourceDependencies = {
  repository: UploadSourceRepository
  knowhere: UploadKnowhereClient
  blobStore?: UploadSourceBlobStore
}

/**
 * Upload a file to Knowhere for parsing.
 *
 * Uses `Effect.scoped` + `TempFile.withFile` so the temp file is guaranteed
 * to be cleaned up even if the upload fails mid-flight.
 */
export const uploadSourceToKnowhereEffect = (
  workspace: Workspace,
  file: File,
  deps: UploadSourceDependencies,
) =>
  Effect.gen(function* () {
    const validation = validateUploadFile(file)
    if (!validation.ok) {
      return yield* Effect.die(new Error(validation.message))
    }

    const source = yield* Effect.promise(() =>
      deps.repository.createUploadingSource(workspace.id, {
        title: validation.title,
        mimeType: validation.mimeType,
        sizeBytes: file.size,
      }),
    )

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const temp = yield* TempFile
        const { path } = yield* temp.withFile(file)

        const job = yield* Effect.tryPromise(() =>
          deps.knowhere.jobs.create({
            sourceType: "file",
            fileName: validation.title,
            namespace: workspace.namespace,
          }),
        )
        yield* Effect.tryPromise(() =>
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
    ).pipe(
      Effect.provide(tempFileLayer),
      Effect.catchAll((err) =>
        Effect.gen(function* () {
          const message = "Knowhere upload failed."
          yield* Effect.promise(() =>
            deps.repository.markSourceFailed(
              workspace.id,
              source.id,
              message,
            ),
          )
          return yield* Effect.die(new Error(message, { cause: err }))
        }),
      ),
    )
  })

export const uploadSourceBlobToKnowhereEffect = (
  workspace: Workspace,
  input: SourceBlobUploadInput,
  deps: UploadSourceDependencies,
) =>
  Effect.gen(function* () {
    const validation = validateSourceBlobUploadInput(input)
    if (!validation.ok) {
      return yield* Effect.die(new Error(validation.message))
    }

    const blobStore = deps.blobStore ?? vercelSourceBlobStore
    const source = yield* Effect.promise(() =>
      deps.repository.createUploadingSource(workspace.id, {
        title: validation.title,
        mimeType: validation.mimeType,
        sizeBytes: input.sizeBytes,
      }),
    )

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const blob = yield* Effect.tryPromise(() =>
          blobStore.get(input.pathname),
        )
        if (!blob || blob.statusCode !== 200 || !blob.stream) {
          return yield* Effect.die(
            new Error("Uploaded file could not be loaded."),
          )
        }

        if (
          typeof blob.blob.size === "number" &&
          blob.blob.size !== input.sizeBytes
        ) {
          return yield* Effect.die(
            new Error("Uploaded file metadata changed before parsing."),
          )
        }

        const temp = yield* TempFile
        const { path } = yield* temp.withStream({
          name: input.fileName,
          stream: blob.stream,
        })

        const job = yield* Effect.tryPromise(() =>
          deps.knowhere.jobs.create({
            sourceType: "file",
            fileName: validation.title,
            namespace: workspace.namespace,
          }),
        )
        yield* Effect.tryPromise(() =>
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
    ).pipe(
      Effect.provide(tempFileLayer),
      Effect.catchAll((err) =>
        Effect.gen(function* () {
          const message = "Knowhere upload failed."
          yield* Effect.promise(() =>
            deps.repository.markSourceFailed(
              workspace.id,
              source.id,
              message,
            ),
          )
          return yield* Effect.die(new Error(message, { cause: err }))
        }),
      ),
      Effect.ensuring(
        Effect.promise(() =>
          blobStore.del(input.pathname).catch(() => undefined),
        ),
      ),
    )
  })

/**
 * Async wrapper for Next.js boundary.
 */
export async function uploadSourceToKnowhere(
  workspace: Workspace,
  file: File,
  deps: UploadSourceDependencies,
): Promise<Source> {
  return Effect.runPromise(uploadSourceToKnowhereEffect(workspace, file, deps))
}

export async function uploadSourceBlobToKnowhere(
  workspace: Workspace,
  input: SourceBlobUploadInput,
  deps: UploadSourceDependencies,
): Promise<Source> {
  return Effect.runPromise(
    uploadSourceBlobToKnowhereEffect(workspace, input, deps),
  )
}

const vercelSourceBlobStore: UploadSourceBlobStore = {
  get: (pathname) => get(pathname, { access: "private", useCache: false }),
  del: (pathname) => del(pathname),
}
