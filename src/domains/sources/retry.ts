import "server-only"

import { Effect } from "effect"

import type { Source, Workspace } from "@/infrastructure/db/schema"
import { getWorkspaceNamespace } from "./namespace"
import type {
  UploadJobResult,
  UploadKnowhereClient,
} from "./source-upload-contracts"
import { sourceFailureMessage } from "./failure-message"

type RetrySourceRepository = {
  readonly markSourceParsing: (
    workspaceId: string,
    sourceId: string,
    jobId: string,
    documentId?: string,
    requiredStatus?: string,
  ) => Promise<Source | null>
  readonly markSourceFailed: (
    workspaceId: string,
    sourceId: string,
    reason: string,
    requiredStatus?: string,
  ) => Promise<Source | null>
}

type RetrySourceDependencies = {
  readonly knowhere: UploadKnowhereClient
  readonly repository: RetrySourceRepository
}

export const retrySourceToKnowhereEffect = (
  workspace: Workspace,
  source: Source,
  deps: RetrySourceDependencies,
) =>
  Effect.gen(function* () {
    if (source.status !== "failed") {
      return yield* Effect.die(
        new Error("Only failed sources can be retried."),
      )
    }

    const originalBlobUrl = source.originalBlobUrl
    const originalBlobPathname = source.originalBlobPathname
    if (!originalBlobUrl || !originalBlobPathname) {
      return yield* Effect.die(
        new Error(
          "This source cannot be retried because its original file is unavailable.",
        ),
      )
    }

    return yield* Effect.gen(function* () {
      const job = yield* Effect.tryPromise(() =>
        deps.knowhere.jobs.create({
          sourceType: "url",
          sourceUrl: originalBlobUrl,
          fileName: source.title,
          namespace: getWorkspaceNamespace(workspace),
          documentMetadata: createNotebookDocumentMetadata({
            title: source.title,
            mimeType: source.mimeType,
            sizeBytes: source.sizeBytes,
          }),
        }),
      )
      const documentId = yield* tryGetPlannedDocumentIdEffect(job, deps)
      const parsingSource = yield* Effect.promise(() =>
        deps.repository.markSourceParsing(
          workspace.id,
          source.id,
          job.jobId,
          documentId ?? undefined,
          "failed",
        ),
      )

      if (!parsingSource) {
        return yield* Effect.die(
          new Error("Source is no longer failed."),
        )
      }

      return parsingSource
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
              "failed",
            ),
          )
          return failedSource ?? source
        }),
      ),
    )
  })

const tryGetPlannedDocumentIdEffect = (
  job: UploadJobResult,
  deps: RetrySourceDependencies,
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
