import "server-only"

import { Effect } from "effect"

import type { Source, Workspace } from "@/infrastructure/db/schema"
import {
  type SourceBlobUploadInput,
  validateSourceBlobUploadInput,
} from "./blob-upload"
import type {
  UploadJobResult,
  UploadSourceDependencies,
} from "./source-upload-contracts"
import { validateUploadFile } from "./validation"
import { TempFile, tempFileLayer } from "@/lib/temp-files"
import { getWorkspaceNamespace } from "./namespace"
import { sourceFailureMessage } from "./failure-message"

/**
 * Upload a browser file to Knowhere for parsing.
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
            namespace: getWorkspaceNamespace(workspace),
            documentMetadata: createNotebookDocumentMetadata({
              title: validation.title,
              mimeType: validation.mimeType,
              sizeBytes: file.size,
            }),
          }),
        )
        yield* Effect.tryPromise(() =>
          deps.knowhere.jobs.upload(job, { file: path }),
        )
        const documentId = yield* tryGetPlannedDocumentIdEffect(job, deps)

        return yield* markSourceParsingEffect({
          workspace,
          source,
          jobId: job.jobId,
          documentId,
          deps,
        })
      }),
    ).pipe(
      Effect.provide(tempFileLayer),
      Effect.catchAll((err) =>
        Effect.gen(function* () {
          const message = sourceFailureMessage.fromUnknown(
            err,
            "Knowhere upload failed.",
          )
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

    const source = yield* Effect.promise(() =>
      deps.repository.createUploadingSource(workspace.id, {
        title: validation.title,
        mimeType: validation.mimeType,
        sizeBytes: input.sizeBytes,
        originalBlobPathname: input.pathname,
        originalBlobUrl: input.url,
      }),
    )

    return yield* Effect.gen(function* () {
      const job = yield* Effect.tryPromise(() =>
        deps.knowhere.jobs.create({
          sourceType: "url",
          sourceUrl: input.url,
          fileName: validation.title,
          namespace: getWorkspaceNamespace(workspace),
          documentMetadata: createNotebookDocumentMetadata({
            title: validation.title,
            mimeType: validation.mimeType,
            sizeBytes: input.sizeBytes,
          }),
        }),
      )
      const documentId = yield* tryGetPlannedDocumentIdEffect(job, deps)

      return yield* markSourceParsingEffect({
        workspace,
        source,
        jobId: job.jobId,
        documentId,
        deps,
      })
    }).pipe(
      Effect.catchAll((err) =>
        Effect.gen(function* () {
          const message = sourceFailureMessage.fromUnknown(
            err,
            "Knowhere upload failed.",
          )
          const failedSource = yield* Effect.promise(() =>
            deps.repository.markSourceFailed(
              workspace.id,
              source.id,
              message,
            ),
          )
          return failedSource
        }),
      ),
    )
  })

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

const tryGetPlannedDocumentIdEffect = (
  job: UploadJobResult,
  deps: UploadSourceDependencies,
) => {
  const plannedDocumentId = getDocumentId(job)
  if (plannedDocumentId !== null) {
    return Effect.succeed(plannedDocumentId)
  }

  return Effect.gen(function* () {
    const currentJob = yield* Effect.tryPromise(() =>
      deps.knowhere.jobs.get(job.jobId),
    )
    return getDocumentId(currentJob)
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))
}

const markSourceParsingEffect = (input: {
  readonly workspace: Workspace
  readonly source: Source
  readonly jobId: string
  readonly documentId: string | null
  readonly deps: UploadSourceDependencies
}) =>
  Effect.promise(() =>
    input.documentId
      ? input.deps.repository.markSourceParsing(
          input.workspace.id,
          input.source.id,
          input.jobId,
          input.documentId,
        )
      : input.deps.repository.markSourceParsing(
          input.workspace.id,
          input.source.id,
          input.jobId,
        ),
  )

function createNotebookDocumentMetadata(input: {
  readonly title: string
  readonly mimeType: string
  readonly sizeBytes: number
}): Readonly<Record<string, unknown>> {
  return {
    createdByClient: "notebook",
    sourceFileName: input.title,
    title: input.title,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  }
}

function getDocumentId(job: UploadJobResult): string | null {
  return typeof job.documentId === "string" && job.documentId.length > 0
    ? job.documentId
    : null
}
