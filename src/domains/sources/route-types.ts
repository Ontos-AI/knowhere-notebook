import type {
  ChunkKnowhereClient,
  ChunkPage,
  ChunkPageParams,
} from "@/domains/chunks"
import type {
  loadChunkPageForSource,
  loadChunksForSource,
} from "@/domains/chunks/server"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceStatus, SourceView } from "@/domains/sources/types"
import type { AuthUser } from "@/infrastructure/auth"
import type { Source, Workspace } from "@/infrastructure/db/schema"
import type { RouteResult } from "@/lib/route-result"
import type { SourceBlobUploadInput } from "./blob-upload"
import type { sourceViewOptionsBySourceId } from "./counts"
import type { UploadKnowhereClient } from "./upload"

type SourceRouteKnowhereClient = UploadKnowhereClient &
  ChunkKnowhereClient & {
    readonly documents: ChunkKnowhereClient["documents"] & {
      list?(params?: {
        readonly namespace?: string
        readonly page?: number
        readonly pageSize?: number
      }): Promise<{
        readonly documents: readonly {
          readonly documentId: string
          readonly namespace: string
          readonly status: string
          readonly currentJobResultId?: string | null
          readonly sourceFileName?: string | null
          readonly documentMetadata?: Record<string, unknown>
        }[]
        readonly pagination?: {
          readonly page?: number
          readonly pageSize?: number
          readonly total?: number
          readonly totalPages?: number
          readonly page_size?: number
          readonly total_pages?: number
        }
      }>
      get?(documentId: string): Promise<{
        readonly documentId: string
        readonly namespace: string
        readonly status: string
        readonly currentJobResultId?: string | null
        readonly sourceFileName?: string | null
      }>
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

type JsonRouteResult<TBody extends object> = RouteResult<TBody>

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

type RetrySourceBody =
  | {
      readonly source: SourceView
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
  /** Optional target workspace (upload destination). Defaults to the active
   *  workspace; when set it must belong to the current user (owned or
   *  member). */
  readonly workspaceId?: string
  readonly onUploadFinished?: () => void
}

type ArchiveSourceInput = {
  readonly cookieHeader: string
  readonly sourceId: string
}

type RetrySourceInput = {
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
  readonly retrySource: (
    input: RetrySourceInput,
  ) => Promise<JsonRouteResult<RetrySourceBody>>
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
  readonly retrySourceToKnowhere: (
    workspace: Workspace,
    source: Source,
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
  readonly localizeRemoteDocument: (
    workspaceId: string,
    input: {
      readonly documentId: string
      readonly namespace?: string
      readonly title?: string
      readonly mimeType?: string
      readonly sizeBytes?: number
      readonly status: SourceStatus
      readonly revisionKey?: string | null
    },
  ) => Promise<Source>
  readonly updateSourceRevisionKey: (
    workspaceId: string,
    sourceId: string,
    revisionKey: string,
  ) => Promise<Source | null>
}

type SourceRouteServiceDependencies = {
  readonly deleteBlob: (pathname: string) => Promise<unknown>
  readonly ensureApiKeyForWorkspace: (
    workspaceId: string,
  ) => Promise<string>
  readonly ensureWorkspace: (userId: string) => Promise<Workspace | null>
  readonly findWorkspaceByIdAndUserId: (
    workspaceId: string,
    userId: string,
  ) => Promise<Workspace | null>
  readonly getCurrentUser: () => Promise<AuthUser | null>
  readonly getSourceViewOptionsBySourceId: (
    sources: readonly Source[],
    client: SourceRouteKnowhereClient,
  ) => ReturnType<typeof sourceViewOptionsBySourceId>
  readonly loadChunkPageForSource: typeof loadChunkPageForSource
  readonly loadChunksForSource: typeof loadChunksForSource
  readonly makeKnowhereClient: (apiKey: string) => SourceRouteKnowhereClient
  readonly listSourcesForWorkspace: (workspaceId: string) => Promise<Source[]>
  readonly reconcileSourcesForWorkspace: (
    workspace: Workspace,
    client: SourceRouteKnowhereClient,
  ) => Promise<Source[]>
  readonly requireUser: () => Promise<AuthUser>
  readonly sourceService: SourceWorkflowService
}

type SourceRouteServiceOverrides = Partial<
  Omit<SourceRouteServiceDependencies, "sourceService">
> & {
  readonly sourceService?: Partial<SourceWorkflowService>
}

export type {
  ArchiveSourceBody,
  ArchiveSourceInput,
  JsonRouteResult,
  ListSourcesBody,
  ListSourcesInput,
  LoadSourceChunksInput,
  RetrySourceBody,
  RetrySourceInput,
  SourceChunksBody,
  SourceRouteKnowhereClient,
  SourceRouteService,
  SourceRouteServiceDependencies,
  SourceRouteServiceOverrides,
  SourceUploadRequest,
  SourceWorkflowService,
  UploadSourceBody,
  UploadSourceInput,
}
