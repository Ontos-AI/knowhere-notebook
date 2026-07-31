import type { NextRequest, NextResponse } from "next/server"

import { withApiErrorResponse } from "@/lib/api-error-response"
import { getCurrentUser } from "@/infrastructure/auth"
import { workspaceService } from "@/domains/workspace/service"
import { ensureApiKeyForWorkspace } from "@/integrations/dashboard/api-key-service"
import { makeKnowhereClient, listKnowhereNamespaces } from "@/integrations/knowhere"
import { nextRouteContext } from "@/lib/next-route-context"
import { nextRouteResponse } from "@/lib/next-route-response"
import { routeResult } from "@/lib/route-result"
import { sourceService } from "@/domains/sources/service"
import { sourceWorkflowRuntime } from "@/domains/sources/workflow-runtime"
import { toSourceView } from "@/domains/sources/view"
import type { SourceStatus } from "@/domains/sources/types"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ namespace: string }> },
): Promise<NextResponse> {
  return withApiErrorResponse(
    "namespaces:localize",
    async () => {
      const { namespace } = await params
      const decodedNamespace = decodeURIComponent(namespace)
      const routeContext = await nextRouteContext.read()
      const user = await getCurrentUser()
      if (!user) {
        return nextRouteResponse.toNextResponse(routeResult.badRequest("Not authenticated."))
      }
      const workspace = await workspaceService.ensureWorkspace(user.id)
      const apiKey = await ensureApiKeyForWorkspace(
        workspace.id,
        routeContext.cookieHeader,
      )
      const client = makeKnowhereClient(apiKey)

      const localSources = await sourceWorkflowRuntime.listForWorkspace(
        workspace.id,
      )
      const localDocumentIds = new Set(
        localSources.flatMap((source) =>
          source.knowhereDocumentId ? [source.knowhereDocumentId] : [],
        ),
      )

      let allNamespaces: string[]
      if (decodedNamespace === "all") {
        const namespaces = await listKnowhereNamespaces(apiKey)
        allNamespaces = namespaces.map((ns) => ns.namespace)
      } else {
        allNamespaces = [decodedNamespace]
      }

      const newSources = []
      for (const ns of allNamespaces) {
        let page = 1
        let totalPages = 1
        do {
          const response = await client.documents.list({
            namespace: ns,
            page,
            pageSize: 200,
          })
          for (const doc of response.documents ?? []) {
            if (!doc.documentId) continue
            if (localDocumentIds.has(doc.documentId)) continue

            const status: SourceStatus =
              doc.status === "active" || doc.status === "ready" || doc.status === "done"
                ? "ready"
                : doc.status === "failed"
                  ? "failed"
                  : "parsing"

            const source = await sourceService.localizeRemoteDocument(
              workspace.id,
              {
                documentId: doc.documentId,
                namespace: doc.namespace ?? ns,
                status,
                title: doc.sourceFileName ?? undefined,
                revisionKey: doc.currentJobResultId ?? null,
              },
            )
            newSources.push(source)
          }
          const pagination = response.pagination
          const tp = pagination?.totalPages ?? 1
          totalPages = typeof tp === "number" && tp > 0 ? Math.floor(tp) : 1
          page += 1
        } while (page <= totalPages)
      }

      return nextRouteResponse.toNextResponse(
        routeResult.ok({
          sources: newSources.map((source) => toSourceView(source)),
        }),
      )
    },
    "Could not import documents from this namespace.",
  )
}
