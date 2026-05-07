import "server-only"

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Context, Effect, Layer, Scope } from "effect"

import type { TempFileStore } from "./source-upload"

/**
 * Effect service for scoped temporary file creation.
 *
 * `withFile` creates a temp directory + writes the file, returning the path.
 * Cleanup is guaranteed via `Effect.acquireRelease` — the temp directory is
 * removed when the enclosing `Effect.scoped` completes, even on failure.
 */
export class TempFile extends Context.Tag("@knowhere/TempFile")<
  TempFile,
  {
    readonly withFile: (
      file: File,
    ) => Effect.Effect<{ path: string }, never, Scope.Scope>
  }
>() {}

export const tempFileLayer = Layer.succeed(TempFile, {
  withFile: (file: File) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "knowhere-notebook-")),
        )
        const path = join(directory, basename(file.name))
        const bytes = new Uint8Array(
          yield* Effect.promise(() => file.arrayBuffer()),
        )
        yield* Effect.promise(() => writeFile(path, bytes))
        return { path, directory }
      }),
      ({ directory }) =>
        Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
})

// ---- Legacy API (Promise-based, for non-Effect callers) -------------------

export const localTempFiles: TempFileStore = {
  async write(file) {
    const directory = await mkdtemp(join(tmpdir(), "knowhere-notebook-"))
    const path = join(directory, basename(file.name))
    const bytes = new Uint8Array(await file.arrayBuffer())
    await writeFile(path, bytes)
    return {
      path,
      async cleanup() {
        await rm(directory, { recursive: true, force: true })
      },
    }
  },
}
