import "server-only"

import { createWriteStream } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { Context, Effect, Layer, Scope } from "effect"


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
    readonly withStream: (input: {
      readonly name: string
      readonly stream: ReadableStream<Uint8Array>
    }) => Effect.Effect<{ path: string }, never, Scope.Scope>
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
  withStream: ({ name, stream }) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "knowhere-notebook-")),
        )
        const path = join(directory, basename(name))
        yield* Effect.promise(() =>
          pipeline(
            Readable.fromWeb(
              stream as unknown as NodeReadableStream<Uint8Array>,
            ),
            createWriteStream(path),
          ),
        )
        return { path, directory }
      }),
      ({ directory }) =>
        Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
})
