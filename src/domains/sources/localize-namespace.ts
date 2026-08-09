import "server-only"

import { logger } from "@/lib/logger"
import type { Workspace } from "@/infrastructure/db/schema"
import { makeKnowhereClient } from "@/integrations/knowhere"
import { sourceService } from "./service"
import { sourceWorkflowRuntime } from "./workflow-runtime"
import { toSourceView } from "./view"
import type { SourceStatus } from "./types"

/**
 * Eagerly localize all documents in the workspace's own namespace into that
 * workspace. Returns the freshly-localized SourceViews. Used when a workspace
 * is created by picking a namespace, and after key add for the home
 * workspace.
 */
export async function localizeWorkspaceNamespace(
  workspace: Workspace,
  apiKey: string,
): Promise<ReturnType<typeof toSourceView>[]> {
  const client = makeKnowhereClient(apiKey)

  const localSources = await sourceWorkflowRuntime.listForWorkspace(
    workspace.id,
  )
  const localDocumentIds = new Set(
    localSources.flatMap((source) =>
      source.knowhereDocumentId ? [source.knowhereDocumentId] : [],
    ),
  )

  const newSources = []
  let page = 1
  let totalPages = 1
  do {
    const response = await client.documents.list({
      namespace: workspace.namespace,
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
          namespace: doc.namespace ?? workspace.namespace,
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

  if (newSources.length > 0) {
    logger.info("workspaces: localized namespace documents", {
      workspaceId: workspace.id,
      namespace: workspace.namespace,
      count: newSources.length,
    })
  }

  return newSources.map((source) => toSourceView(source))
}
