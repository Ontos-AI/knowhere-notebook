import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { NextResponse, type NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import {
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
