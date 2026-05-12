import type { NextResponse } from "next/server"

import { sourceService } from "@/domains/sources/service"
import { toSourceView } from "@/domains/sources/view"
import { notebookRequestContext } from "@/domains/workspace/request-context"
import { knowhereDemoApi } from "@/integrations/knowhere-demo"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"

export async function POST(request: Request): Promise<NextResponse> {
  const body = await routeResult.readJson(request)
  if (!body.ok) {
    return nextRouteResponse.toNextResponse(
      routeResult.badRequest("Invalid request body."),
    )
  }

  const demoSourceIds = getDemoSourceIds(body.value)
  if (demoSourceIds.length === 0) {
    return nextRouteResponse.toNextResponse(
      routeResult.badRequest("Select at least one demo source."),
    )
  }

  try {
    const { apiKey, workspace } =
      await notebookRequestContext.getAuthenticatedWithClient()
    const hiddenDemoSourceIds = new Set(
      await sourceService.listHiddenDemoSourceIds(workspace.id),
    )
    const visibleDemoSourceIds = demoSourceIds.filter(
      (demoSourceId) => !hiddenDemoSourceIds.has(demoSourceId),
    )
    if (visibleDemoSourceIds.length === 0) {
      return nextRouteResponse.toNextResponse(
        routeResult.badRequest("Selected demo sources are no longer available."),
      )
    }

    const materializedSources = await knowhereDemoApi.materializeSources({
      apiKey,
      namespace: workspace.namespace,
      demoSourceIds: visibleDemoSourceIds,
    })
    const sources = await Promise.all(
      materializedSources.map(async (source) => {
        const row = await sourceService.upsertMaterializedDemoSource(
          workspace.id,
          {
            demoSourceId: source.demoSourceId,
            title: source.title,
            mimeType: source.mimeType,
            sizeBytes: source.sizeBytes,
            knowhereDocumentId: source.documentId,
            originalBlobUrl: `/api/demo-sources/${encodeURIComponent(
              source.demoSourceId,
            )}/original`,
          },
        )
        return toSourceView(row, { chunkCount: source.chunkCount })
      }),
    )

    return nextRouteResponse.toNextResponse(routeResult.ok({ sources }))
  } catch {
    return nextRouteResponse.toNextResponse(
      routeResult.error(502, "Demo sources could not be prepared right now."),
    )
  }
}

function getDemoSourceIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.demoSourceIds)) return []

  const selectedIds = value.demoSourceIds.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  )
  return Array.from(new Set(selectedIds.map((item) => item.trim())))
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}
