import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { Effect } from "effect"

import { ensureApiKeyForWorkspace } from "@/lib/api-key-service"
import { getCurrentUser } from "@/lib/auth"
import { withApiErrorResponse } from "@/lib/api-error-response"
import { demoData } from "@/lib/demo-data"
import { makeKnowhereClient } from "@/lib/knowhere"
import { sourceViewOptionsBySourceId } from "@/lib/source-counts"
import {
  type UploadSourceDependencies,
  uploadSourceBlobToKnowhere,
  uploadSourceToKnowhere,
} from "@/lib/source-upload"
import {
  parseSourceBlobUploadBody,
  type SourceBlobUploadInput,
  validateSourceBlobUploadInput,
} from "@/lib/source-blob-upload"
import { validateUploadFile } from "@/lib/source-validation"
import { reconcileSourcesForWorkspace } from "@/lib/source-reconcile"
import { toSourceView } from "@/lib/source-view"
import {
  createUploadingSource,
  ensureWorkspace,
  markSourceFailed,
  markSourceParsing,
} from "@/lib/workspace"

export async function GET(): Promise<NextResponse> {
  return withApiErrorResponse("sources:list", async () => {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ sources: demoData.listSources() });
    }

    const workspace = await ensureWorkspace(user.id);
    const cookieHeader = (await headers()).get("cookie") ?? ""
    const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
    const client = makeKnowhereClient(apiKey)
    const sources = await reconcileSourcesForWorkspace(workspace, client);
    const sourceOptions = await Effect.runPromise(
      sourceViewOptionsBySourceId(sources, client),
    )

    return NextResponse.json({
      sources: sources.map((source) =>
        toSourceView(source, sourceOptions.get(source.id)),
      ),
    });
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withApiErrorResponse(
    "sources:upload",
    async () => {
      const user = await getCurrentUser()
      if (!user) {
        return NextResponse.json(
          { message: "Please log in to upload documents." },
          { status: 401 },
        )
      }

      const upload = await readSourceUploadRequest(request)
      if (upload.type === "error") {
        return NextResponse.json(
          { message: upload.message },
          { status: 400 },
        )
      }

      const validation = upload.type === "file"
        ? validateUploadFile(upload.file)
        : validateSourceBlobUploadInput(upload.input)
      if (!validation.ok) {
        return NextResponse.json({ message: validation.message }, { status: 400 })
      }

      const workspace = await ensureWorkspace(user.id)
      const cookieHeader = (await headers()).get("cookie") ?? ""
      const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
      const uploadDependencies = {
        repository: {
          createUploadingSource,
          markSourceParsing: async (...args) => {
            const source = await markSourceParsing(...args)
            if (!source) throw new Error("Source disappeared before parsing.")
            return source
          },
          markSourceFailed: async (...args) => {
            const source = await markSourceFailed(...args)
            if (!source) throw new Error("Source disappeared before failure.")
            return source
          },
        },
        knowhere: makeKnowhereClient(apiKey),
      } satisfies UploadSourceDependencies
      const source = await (
        upload.type === "file"
          ? uploadSourceToKnowhere(workspace, upload.file, uploadDependencies)
          : uploadSourceBlobToKnowhere(workspace, upload.input, uploadDependencies)
      ).finally(() => {
        revalidatePath("/")
      })

      return NextResponse.json({ source: toSourceView(source) }, { status: 201 })
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
