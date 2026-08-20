import "server-only"

import { del } from "@vercel/blob"
import type { Knowledge } from "@ontos-ai/knowhere-sdk"

import { ensureApiKeyForWorkspace } from "@/integrations/dashboard/api-key-service"
import {
  makeKnowhereClient as makeDefaultKnowhereClient,
  makeKnowhereClientWithParsedStorage,
} from "@/integrations/knowhere"
import { knowhereDemoApi } from "@/integrations/knowhere-demo"
import { getCurrentUser, requireUser } from "@/infrastructure/auth"
import { workspaceService } from "@/domains/workspace/service"
import { sourceViewOptionsBySourceId as getDefaultSourceViewOptionsBySourceId } from "./counts"
import { createParsedDocumentSyncScheduler } from "./parsed-document-sync-scheduler"
import { reconcileSourcesForWorkspace as reconcileDefaultSourcesForWorkspace } from "./reconcile"
import { sourceWorkflowRuntime } from "./workflow-runtime"
import { sourceService as defaultSourceService } from "./service"
import type {
  SourceRouteKnowhereClient,
  SourceRouteServiceDependencies,
  SourceRouteServiceOverrides,
} from "./route-types"

const defaultDependencies: SourceRouteServiceDependencies = {
  deleteBlob: del,
  demoApi: knowhereDemoApi,
  ensureApiKeyForWorkspace,
  ensureWorkspace: workspaceService.ensureWorkspace,
  getCurrentUser,
  getSourceViewOptionsBySourceId: (sources, client, options) =>
    getDefaultSourceViewOptionsBySourceId(
      sources,
      client as ReturnType<typeof makeDefaultKnowhereClient>,
      options,
    ),
  makeKnowhereClient: (apiKey: string) =>
    makeDefaultKnowhereClient(apiKey) as SourceRouteKnowhereClient,
  listSourcesForWorkspace: sourceWorkflowRuntime.listForWorkspace,
  reconcileSourcesForWorkspace: (workspace, client) =>
    reconcileDefaultSourcesForWorkspace(
      workspace,
      client as ReturnType<typeof makeDefaultKnowhereClient>,
    ),
  requireUser,
  sourceService: {
    findInWorkspace: defaultSourceService.findInWorkspace,
    findByKnowhereDocumentId: defaultSourceService.findByKnowhereDocumentId,
    hideDemoSource: defaultSourceService.hideDemoSource,
    listHiddenDemoSourceIds: defaultSourceService.listHiddenDemoSourceIds,
    localizeRemoteDocument: defaultSourceService.localizeRemoteDocument,
    softDelete: defaultSourceService.softDelete,
    upsertMaterializedDemoSource:
      defaultSourceService.upsertMaterializedDemoSource,
    retrySourceToKnowhere: defaultSourceService.retrySourceToKnowhere,
    uploadSourceBlobToKnowhere: defaultSourceService.uploadSourceBlobToKnowhere,
    uploadSourceToKnowhere: defaultSourceService.uploadSourceToKnowhere,
  },
}

function createSourceRouteDependencies(
  overrides: SourceRouteServiceOverrides,
): SourceRouteServiceDependencies {
  return {
    ...defaultDependencies,
    ...overrides,
    demoApi: {
      ...defaultDependencies.demoApi,
      ...overrides.demoApi,
    },
    sourceService: {
      ...defaultDependencies.sourceService,
      ...overrides.sourceService,
    },
  }
}

async function getClientForWorkspace(
  workspaceId: string,
  cookieHeader: string,
  deps: Pick<
    SourceRouteServiceDependencies,
    "ensureApiKeyForWorkspace" | "makeKnowhereClient"
  >,
): Promise<SourceRouteKnowhereClient> {
  const apiKey = await deps.ensureApiKeyForWorkspace(workspaceId, cookieHeader)
  return deps.makeKnowhereClient(apiKey)
}

/**
 * Build a `Knowledge` configured with Vercel-Blob parsed storage plus a
 * QStash-backed background-sync scheduler bound to this source's document.
 * Chunk reads go through the returned `knowledge`; on a storage miss the SDK
 * serves from Knowhere remote and the scheduler enqueues a durable backfill.
 */
function getKnowledgeForSource(input: {
  readonly apiKey: string
  readonly workspaceId: string
  readonly sourceId: string
  readonly documentId: string
  readonly revisionKey?: string | null
}): Knowledge {
  return getKnowledgeResourcesForSource(input).knowledge
}

function getKnowledgeResourcesForSource(input: {
  readonly apiKey: string
  readonly workspaceId: string
  readonly sourceId: string
  readonly documentId: string
  readonly revisionKey?: string | null
}): { readonly client: SourceRouteKnowhereClient; readonly knowledge: Knowledge } {
  const scheduler = createParsedDocumentSyncScheduler({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    documentId: input.documentId,
    apiKey: input.apiKey,
    revisionKey: input.revisionKey ?? undefined,
  })
  const resources = makeKnowhereClientWithParsedStorage(input.apiKey, {
    workspaceId: input.workspaceId,
    scheduler,
  })
  return { client: resources.client, knowledge: resources.knowledge }
}

export {
  createSourceRouteDependencies,
  getClientForWorkspace,
  getKnowledgeForSource,
  getKnowledgeResourcesForSource,
}
