import type {
  ChunkKnowhereClient,
  ChunkPage,
  ChunkPageParams,
  loadChunkPageForSource,
  loadChunksForSource,
} from "@/domains/chunks"
import type { ParsedChunkView } from "@/domains/chunks/types"
import type { SourceView } from "@/domains/sources/types"
import type { AuthUser } from "@/infrastructure/auth"
import type { Source, Workspace } from "@/infrastructure/db/schema"
import type { RouteResult } from "@/lib/route-result"
import type { SourceBlobUploadInput } from "./blob-upload"
import type { sourceViewOptionsBySourceId } from "./counts"
import type { DemoSourceSeed } from "./demo-data"
import type { UploadKnowhereClient } from "./upload"

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
}

type SourceRouteDemoData = {
  readonly getSourceSeedByDemoKey: (
    demoKey: string | null | undefined,
  ) => DemoSourceSeed | null
  readonly listSources: () => readonly SourceView[]
  readonly loadChunksForDocumentId: (
    documentId: string | null | undefined,
  ) => Promise<readonly ParsedChunkView[] | null>
  readonly loadChunksForSource: (
    sourceId: string,
  ) => Promise<readonly ParsedChunkView[] | null>
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
  ) => ReturnType<typeof sourceViewOptionsBySourceId>
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

export type {
  ArchiveSourceBody,
  ArchiveSourceInput,
  JsonRouteResult,
  ListSourcesBody,
  ListSourcesInput,
  LoadSourceChunksInput,
  SourceChunksBody,
  SourceRouteDemoData,
  SourceRouteKnowhereClient,
  SourceRouteService,
  SourceRouteServiceDependencies,
  SourceRouteServiceOverrides,
  SourceUploadRequest,
  SourceWorkflowService,
  UploadSourceBody,
  UploadSourceInput,
}
