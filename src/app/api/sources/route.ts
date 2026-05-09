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
import { uploadSourceToKnowhere } from "@/lib/source-upload"
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

      const formData = await request.formData()
      const file = formData.get("file")
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json(
          { message: "Choose a document to upload." },
          { status: 400 },
        )
      }

      const validation = validateUploadFile(file)
      if (!validation.ok) {
        return NextResponse.json({ message: validation.message }, { status: 400 })
      }

      const workspace = await ensureWorkspace(user.id)
      const cookieHeader = (await headers()).get("cookie") ?? ""
      const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
      const source = await uploadSourceToKnowhere(workspace, file, {
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
      }).finally(() => {
        revalidatePath("/")
      })

      return NextResponse.json({ source: toSourceView(source) }, { status: 201 })
    },
    "Upload failed. Try again or choose another file.",
  )
}
