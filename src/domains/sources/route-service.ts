import "server-only"

import { del } from "@vercel/blob"
import { Effect } from "effect"

import {
  loadChunkPageForSource,
  loadChunksForSource,
  type ChunkKnowhereClient,
  type ChunkPage,
  type ChunkPageParams,
} from "@/domains/chunks"
import { ensureApiKeyForWorkspace } from "@/integrations/dashboard/api-key-service"
import { getCurrentUser, requireUser, type AuthUser } from "@/infrastructure/auth"
import { makeKnowhereClient as makeDefaultKnowhereClient } from "@/integrations/knowhere"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"
import type { Source, Workspace } from "@/infrastructure/db/schema"
import { workspaceService } from "@/domains/workspace/service"
import {
  type SourceBlobUploadInput,
  validateSourceBlobUploadInput,
} from "./blob-upload"
import { sourceViewOptionsBySourceId as getDefaultSourceViewOptionsBySourceId } from "./counts"
import { demoData as defaultDemoData } from "./demo-data"
import { reconcileSourcesForWorkspace as reconcileDefaultSourcesForWorkspace } from "./reconcile"
import { sourceService as defaultSourceService } from "./service"
import { type UploadKnowhereClient } from "./upload"
import { validateUploadFile } from "./validation"
import { toSourceView } from "./view"

type SourceRouteKnowhereClient = UploadKnowhereClient &
  ChunkKnowhereClient & {
    readonly documents: ChunkKnowhereClient["documents"] & {
      archive(documentId: string): Promise<unknown>
    }
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

type JsonRouteResult<TBody extends object> = {
  readonly status: number
  readonly body: TBody
}

type ListSourcesBody = {
  readonly sources: readonly SourceView[]
}

type UploadSourceBody =
  | {
      readonly source: SourceView
    }
  | {
      readonly message: string
    }

type ArchiveSourceBody =
  | {
      readonly id: string
      readonly archived: true
    }
  | {
      readonly message: string
    }

type SourceChunksBody =
  | {
      readonly chunks: readonly ParsedChunkView[]
    }
  | ChunkPage
  | {
      readonly message: string
    }

type ListSourcesInput = {
  readonly cookieHeader: string
}

type UploadSourceInput = {
  readonly cookieHeader: string
  readonly upload: SourceUploadRequest
  readonly onUploadFinished?: () => void
}

type ArchiveSourceInput = {
  readonly cookieHeader: string
  readonly sourceId: string
}

type LoadSourceChunksInput = {
  readonly cookieHeader: string
  readonly sourceId: string
  readonly shouldLoadAll: boolean
  readonly pageParams: ChunkPageParams
}

type SourceRouteService = {
  readonly listSources: (
    input: ListSourcesInput,
  ) => Promise<JsonRouteResult<ListSourcesBody>>
  readonly uploadSource: (
    input: UploadSourceInput,
  ) => Promise<JsonRouteResult<UploadSourceBody>>
  readonly archiveSource: (
    input: ArchiveSourceInput,
  ) => Promise<JsonRouteResult<ArchiveSourceBody>>
  readonly loadSourceChunks: (
    input: LoadSourceChunksInput,
  ) => Promise<JsonRouteResult<SourceChunksBody>>
}

type SourceWorkflowService = {
  readonly uploadSourceToKnowhere: (
    workspace: Workspace,
    file: File,
    knowhere: UploadKnowhereClient,
  ) => Promise<Source>
  readonly uploadSourceBlobToKnowhere: (
    workspace: Workspace,
    input: SourceBlobUploadInput,
    knowhere: UploadKnowhereClient,
  ) => Promise<Source>
  readonly findInWorkspace: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Source | null>
  readonly softDelete: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<boolean>
  readonly getParseAssetUrls: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<Readonly<Record<string, string>>>
}

type SourceRouteDemoData = {
  readonly getSourceSeedByDemoKey: typeof defaultDemoData.getSourceSeedByDemoKey
  readonly listSources: typeof defaultDemoData.listSources
  readonly loadChunksForDocumentId: typeof defaultDemoData.loadChunksForDocumentId
  readonly loadChunksForSource: typeof defaultDemoData.loadChunksForSource
}

type SourceRouteServiceDependencies = {
  readonly deleteBlob: (pathname: string) => Promise<unknown>
  readonly demoData: SourceRouteDemoData
  readonly ensureApiKeyForWorkspace: (
    workspaceId: string,
    cookieHeader: string,
  ) => Promise<string>
  readonly ensureWorkspace: (userId: string) => Promise<Workspace>
  readonly getCurrentUser: () => Promise<AuthUser | null>
  readonly getSourceViewOptionsBySourceId: (
    sources: readonly Source[],
    client: SourceRouteKnowhereClient,
  ) => ReturnType<typeof getDefaultSourceViewOptionsBySourceId>
  readonly loadChunkPageForSource: typeof loadChunkPageForSource
  readonly loadChunksForSource: typeof loadChunksForSource
  readonly makeKnowhereClient: (apiKey: string) => SourceRouteKnowhereClient
  readonly reconcileSourcesForWorkspace: (
    workspace: Workspace,
    client: SourceRouteKnowhereClient,
  ) => Promise<Source[]>
  readonly requireUser: () => Promise<AuthUser>
  readonly sourceService: SourceWorkflowService
}

type SourceRouteServiceOverrides = Partial<
  Omit<SourceRouteServiceDependencies, "demoData" | "sourceService">
> & {
  readonly demoData?: Partial<SourceRouteDemoData>
  readonly sourceService?: Partial<SourceWorkflowService>
}

const defaultDependencies: SourceRouteServiceDependencies = {
  deleteBlob: del,
  demoData: defaultDemoData,
  ensureApiKeyForWorkspace,
  ensureWorkspace: workspaceService.ensureWorkspace,
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
  reconcileSourcesForWorkspace: (workspace, client) =>
    reconcileDefaultSourcesForWorkspace(
      workspace,
      client as ReturnType<typeof makeDefaultKnowhereClient>,
    ),
  requireUser,
  sourceService: {
    findInWorkspace: defaultSourceService.findInWorkspace,
    getParseAssetUrls: defaultSourceService.getParseAssetUrls,
    softDelete: defaultSourceService.softDelete,
    uploadSourceBlobToKnowhere: defaultSourceService.uploadSourceBlobToKnowhere,
    uploadSourceToKnowhere: defaultSourceService.uploadSourceToKnowhere,
  },
}

export function createSourceRouteService(
  overrides: SourceRouteServiceOverrides = {},
): SourceRouteService {
  const deps = createDependencies(overrides)

  return {
    listSources: (input: ListSourcesInput) => listSources(input, deps),
    uploadSource: (input: UploadSourceInput) => uploadSource(input, deps),
    archiveSource: (input: ArchiveSourceInput) => archiveSource(input, deps),
    loadSourceChunks: (input: LoadSourceChunksInput) =>
      loadSourceChunks(input, deps),
  }
}

async function listSources(
  input: ListSourcesInput,
  deps: SourceRouteServiceDependencies,
): Promise<JsonRouteResult<ListSourcesBody>> {
  const user = await deps.getCurrentUser()
  if (!user) {
    return {
      status: 200,
      body: { sources: deps.demoData.listSources() },
    }
  }

  const workspace = await deps.ensureWorkspace(user.id)
  const client = await getClientForWorkspace(workspace, input.cookieHeader, deps)
  const sources = await deps.reconcileSourcesForWorkspace(workspace, client)
  const sourceOptions = await Effect.runPromise(
    deps.getSourceViewOptionsBySourceId(sources, client),
  )

  return {
    status: 200,
    body: {
      sources: sources.map((source) =>
        toSourceView(source, sourceOptions.get(source.id)),
      ),
    },
  }
}

async function uploadSource(
  input: UploadSourceInput,
  deps: SourceRouteServiceDependencies,
): Promise<JsonRouteResult<UploadSourceBody>> {
  const user = await deps.getCurrentUser()
  if (!user) {
    return {
      status: 401,
      body: { message: "Please log in to upload documents." },
    }
  }

  if (input.upload.type === "error") {
    return {
      status: 400,
      body: { message: input.upload.message },
    }
  }

  const validation =
    input.upload.type === "file"
      ? validateUploadFile(input.upload.file)
      : validateSourceBlobUploadInput(input.upload.input)
  if (!validation.ok) {
    return {
      status: 400,
      body: { message: validation.message },
    }
  }

  const workspace = await deps.ensureWorkspace(user.id)
  const client = await getClientForWorkspace(workspace, input.cookieHeader, deps)
  const source = await uploadToKnowhere(workspace, input.upload, client, deps)
    .finally(() => {
      input.onUploadFinished?.()
    })

  return {
    status: 201,
    body: { source: toSourceView(source) },
  }
}

async function archiveSource(
  input: ArchiveSourceInput,
  deps: SourceRouteServiceDependencies,
): Promise<JsonRouteResult<ArchiveSourceBody>> {
  const user = await deps.requireUser()
  const workspace = await deps.ensureWorkspace(user.id)
  const source = await deps.sourceService.findInWorkspace(
    workspace.id,
    input.sourceId,
  )

  if (!source) {
    return {
      status: 404,
      body: { message: "Source not found." },
    }
  }

  const isDemoSource = Boolean(
    source.demoKey && deps.demoData.getSourceSeedByDemoKey(source.demoKey),
  )

  if (!isDemoSource && source.knowhereDocumentId) {
    const client = await getClientForWorkspace(
      workspace,
      input.cookieHeader,
      deps,
    )
    await client.documents.archive(source.knowhereDocumentId)
  }

  await deps.sourceService.softDelete(workspace.id, input.sourceId)
  if (!isDemoSource && source.originalBlobPathname) {
    try {
      await deps.deleteBlob(source.originalBlobPathname)
    } catch {
      // Source archival already succeeded; Blob cleanup is best-effort.
    }
  }

  return {
    status: 200,
    body: { id: input.sourceId, archived: true },
  }
}

async function loadSourceChunks(
  input: LoadSourceChunksInput,
  deps: SourceRouteServiceDependencies,
): Promise<JsonRouteResult<SourceChunksBody>> {
  const user = await deps.getCurrentUser()
  if (!user) {
    const chunks = await deps.demoData.loadChunksForSource(input.sourceId)
    if (!chunks) return sourceNotFound()

    return {
      status: 200,
      body: input.shouldLoadAll
        ? { chunks }
        : toChunkPage(chunks, input.pageParams),
    }
  }

  const workspace = await deps.ensureWorkspace(user.id)
  const source = await deps.sourceService.findInWorkspace(
    workspace.id,
    input.sourceId,
  )

  if (!source) return sourceNotFound()

  const demoChunks = await deps.demoData.loadChunksForDocumentId(
    source.knowhereDocumentId,
  )
  if (demoChunks) {
    return {
      status: 200,
      body: input.shouldLoadAll
        ? { chunks: demoChunks }
        : toChunkPage(demoChunks, input.pageParams),
    }
  }

  const client = await getClientForWorkspace(workspace, input.cookieHeader, deps)
  const assetUrlsByFilePath = await deps.sourceService.getParseAssetUrls(
    workspace.id,
    source.id,
  )

  if (input.shouldLoadAll) {
    const chunks = await Effect.runPromise(
      deps.loadChunksForSource(source, client, { assetUrlsByFilePath }),
    )
    return {
      status: 200,
      body: { chunks },
    }
  }

  const chunkPage = await Effect.runPromise(
    deps.loadChunkPageForSource(source, client, input.pageParams, {
      assetUrlsByFilePath,
    }),
  )
  return {
    status: 200,
    body: chunkPage,
  }
}

async function uploadToKnowhere(
  workspace: Workspace,
  upload: Exclude<SourceUploadRequest, { readonly type: "error" }>,
  client: SourceRouteKnowhereClient,
  deps: SourceRouteServiceDependencies,
): Promise<Source> {
  return upload.type === "file"
    ? deps.sourceService.uploadSourceToKnowhere(workspace, upload.file, client)
    : deps.sourceService.uploadSourceBlobToKnowhere(
        workspace,
        upload.input,
        client,
      )
}

async function getClientForWorkspace(
  workspace: Workspace,
  cookieHeader: string,
  deps: SourceRouteServiceDependencies,
): Promise<SourceRouteKnowhereClient> {
  const apiKey = await deps.ensureApiKeyForWorkspace(workspace.id, cookieHeader)
  return deps.makeKnowhereClient(apiKey)
}

function sourceNotFound(): JsonRouteResult<{ readonly message: string }> {
  return {
    status: 404,
    body: { message: "Source not found." },
  }
}

function toChunkPage(
  chunks: readonly ParsedChunkView[],
  params: ChunkPageParams,
): ChunkPage {
  const start = (params.page - 1) * params.pageSize
  const pageChunks = chunks.slice(start, start + params.pageSize)
  const totalPages =
    chunks.length === 0 ? 0 : Math.ceil(chunks.length / params.pageSize)

  return {
    chunks: pageChunks,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total: chunks.length,
      totalPages,
    },
  }
}

function createDependencies(
  overrides: SourceRouteServiceOverrides,
): SourceRouteServiceDependencies {
  return {
    ...defaultDependencies,
    ...overrides,
    demoData: {
      ...defaultDependencies.demoData,
      ...overrides.demoData,
    },
    sourceService: {
      ...defaultDependencies.sourceService,
      ...overrides.sourceService,
    },
  }
}
