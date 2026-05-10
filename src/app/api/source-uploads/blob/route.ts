import { del } from "@vercel/blob"
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { NextResponse, type NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import {
  isValidSourceBlobPathname,
  parseSourceBlobClientPayload,
  validateSourceBlobUploadInput,
} from "@/lib/source-blob-upload"
import { MAX_UPLOAD_BYTES } from "@/lib/source-validation"

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { message: "Please log in to upload documents." },
      { status: 401 },
    )
  }

  try {
    const body = (await request.json()) as HandleUploadBody
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const input = parseSourceBlobClientPayload(clientPayload)
        if (!input) {
          throw new Error("Invalid upload metadata.")
        }

        const validation = validateSourceBlobUploadInput({
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
    })

    return NextResponse.json(response)
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Could not prepare the upload."
    return NextResponse.json({ message }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { message: "Please log in to upload documents." },
      { status: 401 },
    )
  }

  try {
    const body = (await request.json()) as unknown
    const pathname = getCleanupPathname(body)
    if (!pathname || !isValidSourceBlobPathname(pathname)) {
      return NextResponse.json(
        { message: "Invalid upload path. Choose the document again." },
        { status: 400 },
      )
    }

    await del(pathname)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { message: "Could not clean up the upload." },
      { status: 500 },
    )
  }
}

function getCleanupPathname(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const pathname = (body as { readonly pathname?: unknown }).pathname
  return typeof pathname === "string" ? pathname : null
}
