import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type {
  ChatArtifactView,
  ChatCitationView,
} from "@/domains/chat/types"
import type { Source } from "@/infrastructure/db/schema"
import { logger } from "@/lib/logger"
import type { LoadSourceAssetUrls } from "./media-assets"
import { resolveAssetUrlFromReferenceText } from "./media-assets"

export type HardenableRetrievalResult = RetrievalResult & {
  readonly pageCitationAssetUrl?: string
}

export type HardenMediaAssetUrlsInput = {
  readonly results: readonly HardenableRetrievalResult[]
  readonly artifacts?: readonly ChatArtifactView[]
}

export type HardenMediaAssetUrlsResult = {
  readonly results: HardenableRetrievalResult[]
  readonly artifacts?: ChatArtifactView[]
}

export type HardenMediaAssetUrls = (
  input: HardenMediaAssetUrlsInput,
) => Promise<HardenMediaAssetUrlsResult>

export type HardenChatMediaAssetUrlsForWorkspaceInput =
  HardenMediaAssetUrlsInput & {
    readonly workspaceId: string
    readonly sources: readonly Source[]
    readonly loadSourceAssetUrls: LoadSourceAssetUrls
  }

type AssetReferenceSource = ChatCitationView["source"]

type AssetUrlReference = {
  readonly assetUrl: string
  readonly source?: AssetReferenceSource
  readonly content?: string
}

type HardeningContext = {
  readonly sourcesByDocumentId: ReadonlyMap<string, Source>
  readonly loadSourceAssetUrls: LoadSourceAssetUrls
  readonly assetUrlsBySourceId: Map<
    string,
    Promise<Readonly<Record<string, string>>>
  >
}

const parsedResultDirectoryName = "parsed-result"
const chatAssetsDirectoryName = "chat-assets"

/**
 * Resolve chat citation/media asset URLs to durable Notebook Blob URLs. The
 * single hardening path is the SDK's `assetUrlPolicy: "durable"` read that
 * `loadSourceAssetUrls` performs; here we only map a retrieval result's
 * reference text to the durable URL that read produced.
 *
 * An asset that is already Notebook-owned is kept as-is. An asset that cannot
 * be resolved to a durable URL is omitted rather than exposing a presigned
 * Knowhere URL to the client.
 */
export async function hardenChatMediaAssetUrls({
  results,
  artifacts,
  sources,
  loadSourceAssetUrls,
}: HardenChatMediaAssetUrlsForWorkspaceInput): Promise<HardenMediaAssetUrlsResult> {
  const context: HardeningContext = {
    sourcesByDocumentId: createSourcesByDocumentId(sources),
    loadSourceAssetUrls,
    assetUrlsBySourceId: new Map(),
  }

  const hardenedResults = await Promise.all(
    results.map((result): Promise<HardenableRetrievalResult> =>
      hardenRetrievalResult(result, context),
    ),
  )
  const hardenedArtifacts = artifacts
    ? await Promise.all(
        artifacts.map((artifact): Promise<ChatArtifactView> =>
          hardenArtifact(artifact, context),
        ),
      )
    : undefined

  return {
    results: hardenedResults,
    ...(hardenedArtifacts ? { artifacts: hardenedArtifacts } : {}),
  }
}

async function hardenRetrievalResult(
  result: HardenableRetrievalResult,
  context: HardeningContext,
): Promise<HardenableRetrievalResult> {
  const assetUrl = getTrimmedString(result.assetUrl)
  const pageCitationAssetUrl = getTrimmedString(result.pageCitationAssetUrl)
  if (!assetUrl && !pageCitationAssetUrl) return result

  const hardenedAssetUrl = assetUrl
    ? await resolveDurableAssetUrl(
        { assetUrl, source: result.source, content: result.content },
        context,
      )
    : undefined
  const hardenedPageCitationAssetUrl = pageCitationAssetUrl
    ? await resolveDurableAssetUrl(
        {
          assetUrl: pageCitationAssetUrl,
          source: result.source,
          content: result.content,
        },
        context,
      )
    : undefined

  return applyAssetUrls(result, {
    hadAssetUrl: Boolean(assetUrl),
    hadPageCitationAssetUrl: Boolean(pageCitationAssetUrl),
    assetUrl: hardenedAssetUrl,
    pageCitationAssetUrl: hardenedPageCitationAssetUrl,
  })
}

async function hardenArtifact(
  artifact: ChatArtifactView,
  context: HardeningContext,
): Promise<ChatArtifactView> {
  const citation = artifact.citation
    ? await hardenCitation(artifact.citation, context)
    : undefined
  const assetUrl = getTrimmedString(artifact.assetUrl)
  const hardenedAssetUrl = assetUrl
    ? await resolveDurableAssetUrl(
        {
          assetUrl,
          source: artifact.citation?.source,
          content: artifact.label,
        },
        context,
      )
    : undefined

  const citationChanged = citation && citation !== artifact.citation
  const assetUrlChanged = assetUrl
    ? hardenedAssetUrl !== artifact.assetUrl
    : false
  if (!citationChanged && !assetUrlChanged) return artifact

  return {
    ...artifact,
    ...(assetUrl ? { assetUrl: hardenedAssetUrl } : {}),
    ...(citation ? { citation } : {}),
  }
}

async function hardenCitation(
  citation: ChatCitationView,
  context: HardeningContext,
): Promise<ChatCitationView> {
  const assetUrl = getTrimmedString(citation.assetUrl)
  const pageCitationAssetUrl = getTrimmedString(citation.pageCitationAssetUrl)
  if (!assetUrl && !pageCitationAssetUrl) return citation

  const hardenedAssetUrl = assetUrl
    ? await resolveDurableAssetUrl(
        { assetUrl, source: citation.source, content: citation.content },
        context,
      )
    : undefined
  const hardenedPageCitationAssetUrl = pageCitationAssetUrl
    ? await resolveDurableAssetUrl(
        {
          assetUrl: pageCitationAssetUrl,
          source: citation.source,
          content: citation.content,
        },
        context,
      )
    : undefined

  return applyAssetUrls(citation, {
    hadAssetUrl: Boolean(assetUrl),
    hadPageCitationAssetUrl: Boolean(pageCitationAssetUrl),
    assetUrl: hardenedAssetUrl,
    pageCitationAssetUrl: hardenedPageCitationAssetUrl,
  })
}

/**
 * Return a durable Notebook-owned URL for a reference: keep already-owned URLs,
 * otherwise resolve against the source's durable parsed asset map. Returns
 * `undefined` when no durable URL is available so callers omit the URL rather
 * than leak a presigned Knowhere URL.
 */
async function resolveDurableAssetUrl(
  reference: AssetUrlReference,
  context: HardeningContext,
): Promise<string | undefined> {
  if (isNotebookOwnedAssetUrl(reference.assetUrl)) {
    return reference.assetUrl
  }

  const source = resolveSourceForReference(reference, context)
  if (!source) return undefined

  const assetUrlsByFilePath = await getCachedSourceAssetUrls(source, context)
  const durableUrl = resolveAssetUrlFromReferenceText({
    values: [
      reference.source?.sectionPath,
      reference.content,
      getAssetUrlPathname(reference.assetUrl),
    ],
    assetUrlsByFilePath,
  })
  return durableUrl ?? undefined
}

function applyAssetUrls<
  T extends {
    readonly assetUrl?: string | null
    readonly pageCitationAssetUrl?: string | null
  },
>(
  value: T,
  hardened: {
    readonly hadAssetUrl: boolean
    readonly hadPageCitationAssetUrl: boolean
    readonly assetUrl: string | undefined
    readonly pageCitationAssetUrl: string | undefined
  },
): T {
  const assetUrlChanged =
    hardened.hadAssetUrl && hardened.assetUrl !== value.assetUrl
  const pageCitationChanged =
    hardened.hadPageCitationAssetUrl &&
    hardened.pageCitationAssetUrl !== value.pageCitationAssetUrl
  if (!assetUrlChanged && !pageCitationChanged) return value

  const next: Record<string, unknown> = { ...value }
  if (hardened.hadAssetUrl) {
    if (hardened.assetUrl) {
      next["assetUrl"] = hardened.assetUrl
    } else {
      delete next["assetUrl"]
    }
  }
  if (hardened.hadPageCitationAssetUrl) {
    if (hardened.pageCitationAssetUrl) {
      next["pageCitationAssetUrl"] = hardened.pageCitationAssetUrl
    } else {
      delete next["pageCitationAssetUrl"]
    }
  }
  return next as T
}

async function getCachedSourceAssetUrls(
  source: Source,
  context: HardeningContext,
): Promise<Readonly<Record<string, string>>> {
  const cached = context.assetUrlsBySourceId.get(source.id)
  if (cached) return cached

  const loaded = context
    .loadSourceAssetUrls(source)
    .catch((error: unknown) => {
      logger.warn("chat: failed to load durable parsed asset map", {
        sourceId: source.id,
        error: formatUnknownError(error),
      })
      return {}
    })
  context.assetUrlsBySourceId.set(source.id, loaded)
  return loaded
}

export function isNotebookOwnedAssetUrl(assetUrl: string): boolean {
  const pathname = getAssetUrlPathname(assetUrl).toLowerCase()
  if (
    pathname.includes(`/${parsedResultDirectoryName}/`) ||
    pathname.includes(`/${chatAssetsDirectoryName}/`) ||
    pathname.includes("/parsed-documents/")
  ) {
    return true
  }

  const absoluteUrl = parseAbsoluteHttpUrl(assetUrl)
  const hostname = absoluteUrl?.hostname.toLowerCase()
  return hostname?.endsWith(".blob.vercel-storage.com") === true
}

function getAssetUrlPathname(assetUrl: string): string {
  try {
    return new URL(assetUrl, "http://notebook.local").pathname
  } catch {
    return assetUrl.split("?")[0] ?? assetUrl
  }
}

function parseAbsoluteHttpUrl(assetUrl: string): URL | null {
  try {
    const url = new URL(assetUrl)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

function resolveSourceForReference(
  reference: AssetUrlReference,
  context: HardeningContext,
): Source | undefined {
  const documentId = getTrimmedString(reference.source?.documentId)
  return documentId ? context.sourcesByDocumentId.get(documentId) : undefined
}

function createSourcesByDocumentId(
  sources: readonly Source[],
): ReadonlyMap<string, Source> {
  return new Map(
    sources.flatMap((source): readonly [string, Source][] =>
      source.knowhereDocumentId ? [[source.knowhereDocumentId, source]] : [],
    ),
  )
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function getTrimmedString(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() ?? ""
  return trimmedValue.length > 0 ? trimmedValue : null
}
