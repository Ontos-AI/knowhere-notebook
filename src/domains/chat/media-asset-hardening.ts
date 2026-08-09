import path from "node:path"
import { createHash } from "node:crypto"
import { put } from "@vercel/blob"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type {
  ChatArtifactView,
  ChatCitationView,
} from "@/domains/chat/types"
import type { Source } from "@/infrastructure/db/schema"
import { logger } from "@/lib/logger"
import type { LoadSourceAssetUrls } from "./media-assets"
import { resolveAssetUrlFromReferenceText } from "./media-assets"

export type HardenMediaAssetUrlsInput = {
  readonly results: readonly RetrievalResult[]
  readonly artifacts?: readonly ChatArtifactView[]
}

export type HardenMediaAssetUrlsResult = {
  readonly results: RetrievalResult[]
  readonly artifacts?: ChatArtifactView[]
}

export type HardenMediaAssetUrls = (
  input: HardenMediaAssetUrlsInput,
) => Promise<HardenMediaAssetUrlsResult>

export type ChatMediaAssetBlobStore = {
  readonly put: (
    pathname: string,
    body: Buffer,
    options: ChatMediaAssetBlobPutOptions,
  ) => Promise<{ readonly url: string }>
}

export type ChatMediaAssetBlobPutOptions = {
  readonly access?: "public"
  readonly allowOverwrite?: boolean
  readonly contentType: string
  readonly multipart?: boolean
}

export type FetchChatMediaAsset = (url: string) => Promise<Response>

export type HardenChatMediaAssetUrlsForWorkspaceInput =
  HardenMediaAssetUrlsInput & {
    readonly workspaceId: string
    readonly sources: readonly Source[]
    readonly loadSourceAssetUrls?: LoadSourceAssetUrls
    readonly blobStore?: ChatMediaAssetBlobStore
    readonly fetchAsset?: FetchChatMediaAsset
  }

type AssetReferenceSource = ChatCitationView["source"]

type AssetUrlReference = {
  readonly assetUrl: string
  readonly source?: AssetReferenceSource
  readonly content?: string
}

type AssetFetchRequest = {
  readonly fetchUrl: string
  readonly canonicalKey: string
  readonly sourceSegment: string
  readonly suggestedFileName: string
}

type HardeningContext = {
  readonly workspaceId: string
  readonly sourcesByDocumentId: ReadonlyMap<string, Source>
  readonly loadSourceAssetUrls?: LoadSourceAssetUrls
  readonly assetUrlsBySourceId: Map<
    string,
    Promise<Readonly<Record<string, string>>>
  >
  readonly hardenedAssetUrlByKey: Map<string, Promise<string>>
  readonly blobStore: ChatMediaAssetBlobStore
  readonly fetchAsset: FetchChatMediaAsset
}

const chatAssetsDirectoryName = "chat-assets"
const parsedResultDirectoryName = "parsed-result"
const fallbackContentType = "application/octet-stream"
const defaultFetchAsset: FetchChatMediaAsset = (url) => fetch(url)
const defaultBlobStore: ChatMediaAssetBlobStore = {
  put: (pathname, body, options) =>
    put(pathname, body, {
      access: options.access ?? "public",
      allowOverwrite: options.allowOverwrite,
      contentType: options.contentType,
      multipart: options.multipart,
    }),
}

export async function hardenChatMediaAssetUrls({
  results,
  artifacts,
  workspaceId,
  sources,
  loadSourceAssetUrls,
  blobStore = defaultBlobStore,
  fetchAsset = defaultFetchAsset,
}: HardenChatMediaAssetUrlsForWorkspaceInput): Promise<HardenMediaAssetUrlsResult> {
  const context: HardeningContext = {
    workspaceId,
    sourcesByDocumentId: createSourcesByDocumentId(sources),
    loadSourceAssetUrls,
    assetUrlsBySourceId: new Map(),
    hardenedAssetUrlByKey: new Map(),
    blobStore,
    fetchAsset,
  }

  const hardenedResults = await Promise.all(
    results.map((result): Promise<RetrievalResult> =>
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
  result: RetrievalResult,
  context: HardeningContext,
): Promise<RetrievalResult> {
  const assetUrl = getTrimmedString(result.assetUrl)
  if (!assetUrl) return result

  const hardenedAssetUrl = await hardenAssetUrl(
    {
      assetUrl,
      source: result.source,
      content: result.content,
    },
    context,
  )
  if (hardenedAssetUrl === result.assetUrl) return result

  return {
    ...result,
    assetUrl: hardenedAssetUrl,
  }
}

async function hardenArtifact(
  artifact: ChatArtifactView,
  context: HardeningContext,
): Promise<ChatArtifactView> {
  const citation = artifact.citation
    ? await hardenCitation(artifact.citation, context)
    : undefined
  const assetUrl = getTrimmedString(artifact.assetUrl)
  if (!assetUrl) {
    return citation && citation !== artifact.citation
      ? { ...artifact, citation }
      : artifact
  }

  const hardenedAssetUrl = await hardenAssetUrl(
    {
      assetUrl,
      source: artifact.citation?.source,
      content: artifact.label,
    },
    context,
  )
  const hasAssetUrlChange = hardenedAssetUrl !== artifact.assetUrl
  const hasCitationChange = citation && citation !== artifact.citation
  if (!hasAssetUrlChange && !hasCitationChange) return artifact

  return {
    ...artifact,
    assetUrl: hardenedAssetUrl,
    ...(citation ? { citation } : {}),
  }
}

async function hardenCitation(
  citation: ChatCitationView,
  context: HardeningContext,
): Promise<ChatCitationView> {
  const assetUrl = getTrimmedString(citation.assetUrl)
  if (!assetUrl) return citation

  const hardenedAssetUrl = await hardenAssetUrl(
    {
      assetUrl,
      source: citation.source,
      content: citation.content,
    },
    context,
  )
  if (hardenedAssetUrl === citation.assetUrl) return citation

  return {
    ...citation,
    assetUrl: hardenedAssetUrl,
  }
}

async function hardenAssetUrl(
  reference: AssetUrlReference,
  context: HardeningContext,
): Promise<string> {
  if (isNotebookOwnedAssetUrl(reference.assetUrl)) {
    return reference.assetUrl
  }

  const parsedAssetUrl = await resolveParsedAssetUrl(reference, context)
  if (parsedAssetUrl) return parsedAssetUrl

  const fetchRequest = resolveAssetFetchRequest(reference.assetUrl)
  if (!fetchRequest) return reference.assetUrl

  const source = resolveSourceForReference(reference, context)
  const sourceSegment = source
    ? `source-${toSafePathSegment(source.id)}`
    : fetchRequest.sourceSegment
  const hardeningKey = [
    context.workspaceId,
    source?.id ?? reference.source?.documentId ?? "",
    fetchRequest.canonicalKey,
  ].join("\0")
  const cached = context.hardenedAssetUrlByKey.get(hardeningKey)
  if (cached) return cached

  const hardenedAssetUrl = copyAssetToBlob({
    reference,
    fetchRequest,
    context,
    sourceSegment,
    hardeningKey,
  })
  context.hardenedAssetUrlByKey.set(hardeningKey, hardenedAssetUrl)
  return hardenedAssetUrl
}

async function resolveParsedAssetUrl(
  reference: AssetUrlReference,
  context: HardeningContext,
): Promise<string | null> {
  const source = resolveSourceForReference(reference, context)
  if (!source || !context.loadSourceAssetUrls) return null

  const assetUrlsByFilePath = await getCachedSourceAssetUrls(source, context)
  return resolveAssetUrlFromReferenceText({
    values: [
      reference.source?.sectionPath,
      reference.content,
      getAssetUrlPathname(reference.assetUrl),
    ],
    assetUrlsByFilePath,
  })
}

async function getCachedSourceAssetUrls(
  source: Source,
  context: HardeningContext,
): Promise<Readonly<Record<string, string>>> {
  const cached = context.assetUrlsBySourceId.get(source.id)
  if (cached) return cached

  const loaded = context.loadSourceAssetUrls
    ? context.loadSourceAssetUrls(source).catch((error: unknown) => {
        logger.warn("chat-agent: failed to load parsed asset map", {
          sourceId: source.id,
          error: formatUnknownError(error),
        })
        return {}
      })
    : Promise.resolve({})
  context.assetUrlsBySourceId.set(source.id, loaded)
  return loaded
}

async function copyAssetToBlob(input: {
  readonly reference: AssetUrlReference
  readonly fetchRequest: AssetFetchRequest
  readonly context: HardeningContext
  readonly sourceSegment: string
  readonly hardeningKey: string
}): Promise<string> {
  try {
    const response = await input.context.fetchAsset(input.fetchRequest.fetchUrl)
    if (!response.ok) {
      logger.warn("chat-agent: media asset hardening fetch failed", {
        assetUrl: redactAssetUrl(input.reference.assetUrl),
        status: response.status,
      })
      return input.reference.assetUrl
    }

    const body = Buffer.from(await response.arrayBuffer())
    const contentType = normalizeContentType(
      response.headers.get("content-type"),
      input.fetchRequest.suggestedFileName,
    )
    const blobPathname = getChatAssetBlobPathname({
      workspaceId: input.context.workspaceId,
      sourceSegment: input.sourceSegment,
      hardeningKey: input.hardeningKey,
      suggestedFileName: input.fetchRequest.suggestedFileName,
      contentType,
    })
    const blob = await input.context.blobStore.put(blobPathname, body, {
      access: "public",
      allowOverwrite: true,
      contentType,
      multipart: true,
    })
    return blob.url
  } catch (error) {
    logger.warn("chat-agent: media asset hardening failed; keeping raw URL", {
      assetUrl: redactAssetUrl(input.reference.assetUrl),
      error: formatUnknownError(error),
    })
    return input.reference.assetUrl
  }
}

function resolveAssetFetchRequest(assetUrl: string): AssetFetchRequest | null {
  const absoluteUrl = parseAbsoluteHttpUrl(assetUrl)
  if (!absoluteUrl) return null

  return {
    fetchUrl: assetUrl,
    canonicalKey: `url:${absoluteUrl.origin}${absoluteUrl.pathname}`,
    sourceSegment: `external-${hashText(absoluteUrl.origin).slice(0, 16)}`,
    suggestedFileName: getPathBasename(absoluteUrl.pathname),
  }
}

function isNotebookOwnedAssetUrl(assetUrl: string): boolean {
  const pathname = getAssetUrlPathname(assetUrl).toLowerCase()
  if (
    pathname.includes(`/${parsedResultDirectoryName}/`) ||
    pathname.includes(`/${chatAssetsDirectoryName}/`)
  ) {
    return true
  }

  const absoluteUrl = parseAbsoluteHttpUrl(assetUrl)
  const hostname = absoluteUrl?.hostname.toLowerCase()
  return hostname?.endsWith(".blob.vercel-storage.com") === true
}

function getChatAssetBlobPathname(input: {
  readonly workspaceId: string
  readonly sourceSegment: string
  readonly hardeningKey: string
  readonly suggestedFileName: string
  readonly contentType: string
}): string {
  const hash = hashText(input.hardeningKey).slice(0, 24)
  const fileName = toSafeFileName(input.suggestedFileName, input.contentType)
  return [
    "workspaces",
    toSafePathSegment(input.workspaceId),
    chatAssetsDirectoryName,
    input.sourceSegment,
    `${hash}-${fileName}`,
  ].join("/")
}

function normalizeContentType(
  value: string | null,
  fileName: string,
): string {
  const normalized = value?.replace(/\s+/g, " ").trim()
  if (normalized) return normalized
  return getContentTypeForPath(fileName)
}

function getContentTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".gif") return "image/gif"
  if (extension === ".webp") return "image/webp"
  if (extension === ".svg") return "image/svg+xml"
  if (extension === ".html" || extension === ".htm") {
    return "text/html; charset=utf-8"
  }
  if (extension === ".csv") return "text/csv; charset=utf-8"
  if (extension === ".pdf") return "application/pdf"
  return fallbackContentType
}

function getExtensionForContentType(contentType: string): string {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase()
  if (normalized === "image/jpeg") return ".jpg"
  if (normalized === "image/png") return ".png"
  if (normalized === "image/gif") return ".gif"
  if (normalized === "image/webp") return ".webp"
  if (normalized === "image/svg+xml") return ".svg"
  if (normalized === "text/html") return ".html"
  if (normalized === "text/csv") return ".csv"
  if (normalized === "application/pdf") return ".pdf"
  return ".bin"
}

function toSafeFileName(fileName: string, contentType: string): string {
  const extension = getSafeFileExtension(fileName, contentType)
  const stem = path.basename(fileName, path.extname(fileName))
  const safeStem = toSafePathSegment(stem)
  return `${safeStem}${extension}`
}

function getSafeFileExtension(fileName: string, contentType: string): string {
  const extension = path.extname(fileName).toLowerCase()
  if (/^\.[a-z0-9]{1,12}$/.test(extension)) return extension
  return getExtensionForContentType(contentType)
}

function getPathBasename(value: string): string {
  const decodedPath = decodeUrlComponent(value)
  const basename = decodedPath.replaceAll("\\", "/").split("/").pop()
  return basename && basename.trim().length > 0 ? basename : "asset"
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

function toSafePathSegment(value: string): string {
  const decoded = decodeUrlComponent(value)
  const normalized = decoded
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return normalized || hashText(value).slice(0, 16)
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function redactAssetUrl(assetUrl: string): string {
  const absoluteUrl = parseAbsoluteHttpUrl(assetUrl)
  if (absoluteUrl) return `${absoluteUrl.origin}${absoluteUrl.pathname}`
  return getAssetUrlPathname(assetUrl)
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function getTrimmedString(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() ?? ""
  return trimmedValue.length > 0 ? trimmedValue : null
}
