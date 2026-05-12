import "server-only"

import { Effect } from "effect"

import type { Source, Workspace } from "@/infrastructure/db/schema"
import type {
  DemoSourceUploadDependencies,
  DemoSourceUploadInput,
} from "./source-upload-contracts"

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

export async function ensureDemoSourceUpload(
  workspace: Workspace,
  input: DemoSourceUploadInput,
  deps: DemoSourceUploadDependencies,
): Promise<Source | null> {
  return Effect.runPromise(ensureDemoSourceUploadEffect(workspace, input, deps))
}
