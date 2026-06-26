import type {
  ChunkKnowhereClient,
  ChunkPage,
  ChunkPageParams,
  loadChunkPageForSource,
  loadChunksForSource,
} from "@/domains/chunks"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceStatus, SourceView } from "@/domains/sources/types"
import type { AuthUser } from "@/infrastructure/auth"
import type { Source, Workspace } from "@/infrastructure/db/schema"
import type {
  DemoCatalog,
  DemoChunkPage,
} from "@/integrations/knowhere-demo"
import type { RouteResult } from "@/lib/route-result"
import type { SourceBlobUploadInput } from "./blob-upload"
import type { sourceViewOptionsBySourceId } from "./counts"
import type { UploadKnowhereClient } from "./upload"

type SourceRouteKnowhereClient = UploadKnowhereClient &
  ChunkKnowhereClient & {
    readonly documents: ChunkKnowhereClient["documents"] & {
      list?(params?: {
        readonly namespace?: string
      }): Promise<{
        readonly documents: readonly {
          readonly documentId: string
          readonly namespace: string
          readonly status: string
          readonly sourceFileName?: string | null
          readonly documentMetadata?: Record<string, unknown>
        }[]
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
  readonly hideDemoSource: (
    workspaceId: string,
    demoSourceId: string,
  ) => Promise<void>
  readonly listHiddenDemoSourceIds: (workspaceId: string) => Promise<string[]>
  readonly localizeRemoteDocument: (
    workspaceId: string,
    input: {
      readonly documentId: string
      readonly title?: string
      readonly mimeType?: string
      readonly sizeBytes?: number
      readonly status: SourceStatus
    },
  ) => Promise<Source>
  readonly upsertMaterializedDemoSource: (
    workspaceId: string,
    input: {
      readonly demoSourceId: string
      readonly title: string
      readonly mimeType: string
      readonly sizeBytes: number
      readonly knowhereDocumentId: string
      readonly originalBlobUrl: string | null
    },
  ) => Promise<Source>
}

type SourceRouteDemoApi = {
  readonly fetchCatalog: () => Promise<DemoCatalog>
  readonly fetchChunkPage: (input: {
    readonly demoSourceId: string
    readonly page: number
    readonly pageSize: number
  }) => Promise<DemoChunkPage>
}

type SourceRouteServiceDependencies = {
  readonly deleteBlob: (pathname: string) => Promise<unknown>
  readonly demoApi: SourceRouteDemoApi
  readonly ensureApiKeyForWorkspace: (
    workspaceId: string,
    cookieHeader: string,
  ) => Promise<string>
  readonly ensureWorkspace: (userId: string) => Promise<Workspace>
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
  Omit<SourceRouteServiceDependencies, "demoApi" | "sourceService">
> & {
  readonly demoApi?: Partial<SourceRouteDemoApi>
  readonly sourceService?: Partial<SourceWorkflowService>
}

export type {
  ArchiveSourceBody,
  ArchiveSourceInput,
  JsonRouteResult,
  ListSourcesBody,
  ListSourcesInput,
  LoadSourceChunksInput,
  SourceChunksBody,
  SourceRouteDemoApi,
  SourceRouteKnowhereClient,
  SourceRouteService,
  SourceRouteServiceDependencies,
  SourceRouteServiceOverrides,
  SourceUploadRequest,
  SourceWorkflowService,
  UploadSourceBody,
  UploadSourceInput,
}
