import { Effect } from "effect"
import { del } from "@vercel/blob"
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import type { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/infrastructure/auth"
import {
  isValidSourceBlobPathname,
  parseSourceBlobClientPayload,
  validateSourceBlobUploadMetadata,
} from "@/domains/sources/blob-upload"
import { MAX_UPLOAD_BYTES } from "@/domains/sources/validation"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function POST(request: NextRequest): Promise<NextResponse> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const user = yield* Effect.tryPromise(() => getCurrentUser())
      if (!user) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(401, "Please log in to upload documents."),
        )
      }

      const body = (yield* Effect.tryPromise(() =>
        request.json(),
      )) as HandleUploadBody

      const result = yield* Effect.tryPromise(() =>
        handleUpload({
          body,
          request,
          onBeforeGenerateToken: async (pathname, clientPayload) => {
            const input = parseSourceBlobClientPayload(clientPayload)
            if (!input) {
              throw new Error("Invalid upload metadata.")
            }

            const validation = validateSourceBlobUploadMetadata({
              ...input,
              pathname,
            })
            if (!validation.ok) {
              throw new Error(validation.message)
            }

            return {
              addRandomSuffix: true,
              allowOverwrite: false,
              maximumSizeInBytes: MAX_UPLOAD_BYTES,
              tokenPayload: JSON.stringify({
                userId: user.id,
                fileName: validation.title,
                mimeType: validation.mimeType,
                sizeBytes: input.sizeBytes,
              }),
            }
          },
        }),
      ).pipe(
        Effect.map((response) =>
          nextRouteResponse.toNextResponse(routeResult.ok(response)),
        ),
        Effect.catchAll((error) => {
          const message =
            error instanceof Error
              ? error.message
              : "Could not prepare the upload."
          return Effect.succeed(
            nextRouteResponse.toNextResponse(routeResult.badRequest(message)),
          )
        }),
      )

      return result
    }),
  )
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const user = yield* Effect.tryPromise(() => getCurrentUser())
      if (!user) {
        return nextRouteResponse.toNextResponse(
          routeResult.error(401, "Please log in to upload documents."),
        )
      }

      const body = (yield* Effect.tryPromise(() =>
        request.json(),
      ).pipe(
        Effect.catchAll(
          (): Effect.Effect<unknown, never> => Effect.succeed(null),
        ),
      )) as unknown

      const pathname = getCleanupPathname(body)
      if (!pathname || !isValidSourceBlobPathname(pathname)) {
        return nextRouteResponse.toNextResponse(
          routeResult.badRequest("Invalid upload path. Choose the document again."),
        )
      }

      yield* Effect.tryPromise(() => del(pathname))
      return nextRouteResponse.toNextResponse(routeResult.ok({ ok: true }))
    }).pipe(
      Effect.catchAll(() =>
        Effect.succeed(
          nextRouteResponse.toNextResponse(
            routeResult.error(500, "Could not clean up the upload."),
          ),
        ),
      ),
    ),
  )
}

function getCleanupPathname(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const pathname = (body as { readonly pathname?: unknown }).pathname
  return typeof pathname === "string" ? pathname : null
}
