import { BlobNotFoundError, get } from "@vercel/blob"
import type { NextRequest } from "next/server"

import { notebookRequestContext } from "@/domains/workspace/request-context"

type ParsedAssetBlobPath = {
  readonly pathname: string
  readonly assetPath: string
}

const notebookBlobHostSuffix = ".blob.vercel-storage.com"
const inlineImageContentTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])
const parsedDocumentsPathPattern =
  /^\/?workspaces\/([^/]+)\/parsed-documents\/[^/]+\/[^/]+\/(.+)$/u
const parsedResultPathPattern =
  /^\/?workspaces\/([^/]+)\/sources\/[^/]+\/parsed-result\/(.+)$/u

export async function GET(request: NextRequest): Promise<Response> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const parsedAssetBlobPath = getParsedAssetBlobPath(
    request.nextUrl.searchParams.get("url"),
    workspace.id,
  )
  if (!parsedAssetBlobPath) {
    return Response.json({ message: "Parsed asset not found." }, { status: 404 })
  }

  try {
    const blob = await get(parsedAssetBlobPath.pathname, { access: "public" })
    if (!blob) {
      return Response.json(
        { message: "Parsed asset not found." },
        { status: 404 },
      )
    }
    if (blob.statusCode !== 200) {
      return new Response(null, { status: 304 })
    }

    const contentType = getInlineImageContentType(
      blob.blob.contentType,
      parsedAssetBlobPath.assetPath,
    )
    if (!contentType) {
      return Response.json(
        { message: "Parsed asset is not an image." },
        { status: 415 },
      )
    }

    return new Response(blob.stream, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": "inline",
        "cache-control": "public, max-age=3600",
      },
    })
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return Response.json(
        { message: "Parsed asset not found." },
        { status: 404 },
      )
    }
    throw error
  }
}

function getParsedAssetBlobPath(
  assetUrl: string | null,
  workspaceId: string,
): ParsedAssetBlobPath | null {
  if (!assetUrl) return null

  const url = parseAbsoluteUrl(assetUrl)
  if (!url) return null
  if (url.protocol !== "https:") return null
  if (!url.hostname.toLowerCase().endsWith(notebookBlobHostSuffix)) return null

  const pathname = decodePathname(url.pathname)
  if (!pathname) return null

  const documentsMatch = parsedDocumentsPathPattern.exec(pathname)
  if (documentsMatch) {
    return getWorkspaceScopedAssetPath(documentsMatch, workspaceId, pathname)
  }

  const parsedResultMatch = parsedResultPathPattern.exec(pathname)
  if (parsedResultMatch) {
    return getWorkspaceScopedAssetPath(parsedResultMatch, workspaceId, pathname)
  }

  return null
}

function getWorkspaceScopedAssetPath(
  match: RegExpExecArray,
  workspaceId: string,
  pathname: string,
): ParsedAssetBlobPath | null {
  const matchedWorkspaceId = match[1]
  const assetPath = match[2]
  if (matchedWorkspaceId !== workspaceId || !assetPath) return null

  return {
    pathname: pathname.replace(/^\/+/u, ""),
    assetPath,
  }
}

function getInlineImageContentType(
  contentType: string | null,
  assetPath: string,
): string | null {
  const normalizedContentType = getBaseContentType(contentType)
  if (normalizedContentType && inlineImageContentTypes.has(normalizedContentType)) {
    return contentType
  }

  return inferImageContentType(assetPath)
}

function getBaseContentType(contentType: string | null): string | null {
  const baseContentType = contentType?.split(";")[0]?.trim().toLowerCase()
  return baseContentType && baseContentType.length > 0 ? baseContentType : null
}

function inferImageContentType(assetPath: string): string | null {
  const pathname = assetPath.toLowerCase().split("?")[0] ?? assetPath
  if (pathname.endsWith(".png")) return "image/png"
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg"
  }
  if (pathname.endsWith(".gif")) return "image/gif"
  if (pathname.endsWith(".webp")) return "image/webp"
  return null
}

function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function decodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}
