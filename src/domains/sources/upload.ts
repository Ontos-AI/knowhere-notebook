import "server-only"

import { Effect } from "effect"
import type { Job } from "@ontos-ai/knowhere-sdk"

import type { Source, Workspace } from "@/infrastructure/db/schema"
import {
  type SourceBlobUploadInput,
  validateSourceBlobUploadInput,
} from "./blob-upload"
import { validateUploadFile } from "./validation"
import { TempFile, tempFileLayer } from "@/lib/temp-files"

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

export type DemoSourceUploadInput = {
  demoKey: string
  documentId: string
  title: string
  mimeType: string
  originalSizeBytes: number
  originalFileUrl: string
  originalFileSystemPath: string
}

export type DemoSourceUploadRepository = Pick<
  UploadSourceRepository,
  "markSourceParsing" | "markSourceFailed"
> & {
  findSourceByDemoKey(
    workspaceId: string,
    demoKey: string,
  ): Promise<Source | null>
  createDemoUploadingSource(
    workspaceId: string,
    input: {
      demoKey: string
      title: string
      mimeType: string
      sizeBytes: number
      originalBlobUrl: string
    },
  ): Promise<Source | null>
  markDemoSourceUploading(
    workspaceId: string,
    sourceId: string,
    input: {
      title: string
      mimeType: string
      sizeBytes: number
      originalBlobUrl: string
    },
  ): Promise<Source>
}

export type DemoSourceUploadDependencies = {
  repository: DemoSourceUploadRepository
  knowhere: UploadKnowhereClient
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
          namespace: workspace.namespace,
        }),
      )

      return yield* Effect.promise(() =>
        deps.repository.markSourceParsing(
          workspace.id,
          source.id,
          job.jobId,
        ),
      )
    }).pipe(
      Effect.catchAll(() =>
        Effect.gen(function* () {
          const message = "Knowhere upload failed."
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

export const ensureDemoSourceUploadEffect = (
  workspace: Workspace,
  input: DemoSourceUploadInput,
  deps: DemoSourceUploadDependencies,
) =>
  Effect.gen(function* () {
    const existingSource = yield* Effect.promise(() =>
      deps.repository.findSourceByDemoKey(workspace.id, input.demoKey),
    )
    if (existingSource && !shouldUploadLegacyDemoSource(existingSource, input)) {
      return existingSource
    }

    const uploadInput = {
      title: input.title,
      mimeType: input.mimeType,
      sizeBytes: input.originalSizeBytes,
      originalBlobUrl: input.originalFileUrl,
    }
    const source = existingSource
      ? yield* Effect.promise(() =>
          deps.repository.markDemoSourceUploading(
            workspace.id,
            existingSource.id,
            uploadInput,
          ),
        )
      : yield* Effect.promise(() =>
          deps.repository.createDemoUploadingSource(workspace.id, {
            demoKey: input.demoKey,
            ...uploadInput,
          }),
        )
    if (!source) {
      return yield* Effect.promise(() =>
        deps.repository.findSourceByDemoKey(workspace.id, input.demoKey),
      )
    }

    return yield* Effect.gen(function* () {
      const job = yield* Effect.tryPromise(() =>
        deps.knowhere.jobs.create({
          sourceType: "file",
          fileName: input.title,
          namespace: workspace.namespace,
        }),
      )
      yield* Effect.tryPromise(() =>
        deps.knowhere.jobs.upload(job, { file: input.originalFileSystemPath }),
      )

      return yield* Effect.promise(() =>
        deps.repository.markSourceParsing(
          workspace.id,
          source.id,
          job.jobId,
        ),
      )
    }).pipe(
      Effect.catchAll(() =>
        Effect.promise(() =>
          deps.repository.markSourceFailed(
            workspace.id,
            source.id,
            "Knowhere upload failed.",
          ),
        ),
      ),
    )
  })

function shouldUploadLegacyDemoSource(
  source: Source,
  input: DemoSourceUploadInput,
): boolean {
  return (
    source.deletedAt === null &&
    source.demoKey === input.demoKey &&
    source.status === "ready" &&
    source.knowhereJobId === null &&
    source.knowhereDocumentId === input.documentId
  )
}

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

export async function ensureDemoSourceUpload(
  workspace: Workspace,
  input: DemoSourceUploadInput,
  deps: DemoSourceUploadDependencies,
): Promise<Source | null> {
  return Effect.runPromise(ensureDemoSourceUploadEffect(workspace, input, deps))
}
