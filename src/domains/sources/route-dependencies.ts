import "server-only"

import { del } from "@vercel/blob"

import {
  loadChunkPageForSource,
  loadChunksForSource,
} from "@/domains/chunks/server"
import { ensureApiKeyForWorkspace } from "@/integrations/knowhere-credentials"
import { makeKnowhereClient as makeDefaultKnowhereClient } from "@/integrations/knowhere"
import { getCurrentUser, requireUser } from "@/infrastructure/auth"
import { workspaceService } from "@/domains/workspace/service"
import { workspaceRepository } from "@/domains/workspace/repository"
import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { sourceViewOptionsBySourceId as getDefaultSourceViewOptionsBySourceId } from "./counts"
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
  ensureApiKeyForWorkspace,
  ensureWorkspace: workspaceService.ensureWorkspace,
  findWorkspaceByIdAndUserId: (workspaceId, userId) =>
    databaseRuntime.runPromise(
      workspaceRepository.findByIdAndUserIdEffect(workspaceId, userId),
    ),
  getCurrentUser,
  getSourceViewOptionsBySourceId: (sources, client) =>
    getDefaultSourceViewOptionsBySourceId(
      sources,
      client as ReturnType<typeof makeDefaultKnowhereClient>,
    ),
  loadChunkPageForSource,
  loadChunksForSource,
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
    getParseAssetUrls: defaultSourceService.getParseAssetUrls,
    localizeRemoteDocument: defaultSourceService.localizeRemoteDocument,
    updateSourceRevisionKey: defaultSourceService.updateSourceRevisionKey,
    softDelete: defaultSourceService.softDelete,
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
  const apiKey = await deps.ensureApiKeyForWorkspace(workspaceId)
  return deps.makeKnowhereClient(apiKey)
}

export { createSourceRouteDependencies, getClientForWorkspace }
