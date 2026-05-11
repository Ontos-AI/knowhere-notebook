import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import {
  parseSourceBlobUploadBody,
  type SourceBlobUploadInput,
} from "@/domains/sources/blob-upload"
import { createSourceRouteService } from "@/domains/sources/route-service"

const sourceRouteService = createSourceRouteService()

export async function GET(): Promise<NextResponse> {
  return withApiErrorResponse("sources:list", async () => {
    const result = await sourceRouteService.listSources({
      cookieHeader: await readCookieHeader(),
    })

    return NextResponse.json(result.body, { status: result.status })
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withApiErrorResponse(
    "sources:upload",
    async () => {
      const upload = await readSourceUploadRequest(request)
      const result = await sourceRouteService.uploadSource({
        cookieHeader: await readCookieHeader(),
        upload,
        onUploadFinished: () => {
          revalidatePath("/")
        },
      })

      return NextResponse.json(result.body, { status: result.status })
    },
    "Upload failed. Try again or choose another file.",
  )
}

type SourceUploadRequest =
  | {
      readonly type: "file"
      readonly file: File
    }
  | {
      readonly type: "blob"
      readonly input: SourceBlobUploadInput
    }
  | {
      readonly type: "error"
      readonly message: string
    }

async function readSourceUploadRequest(
  request: NextRequest,
): Promise<SourceUploadRequest> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as unknown
    const input = parseSourceBlobUploadBody(body)
    if (!input) {
      return {
        type: "error",
        message: "Choose a document to upload.",
      }
    }

    return { type: "blob", input }
  }

  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return {
      type: "error",
      message: "Choose a document to upload.",
    }
  }

  return { type: "file", file }
}

async function readCookieHeader(): Promise<string> {
  return (await headers()).get("cookie") ?? ""
}
