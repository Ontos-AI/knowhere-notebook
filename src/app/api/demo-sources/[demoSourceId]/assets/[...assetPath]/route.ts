import { proxyKnowhereDemoFile } from "@/integrations/knowhere-demo-file-proxy"

type RouteContext = { readonly params: Promise<{ readonly demoSourceId: string; readonly assetPath: string[] }> }

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { demoSourceId, assetPath } = await context.params
  if (assetPath.length === 0 || assetPath.some(isUnsafeAssetSegment)) {
    return Response.json({ message: "Invalid demo asset path." }, { status: 400 })
  }
  const encodedAssetPath: string = assetPath.map(encodeURIComponent).join("/")
  return proxyKnowhereDemoFile(request, `/api/v1/demo/sources/${encodeURIComponent(demoSourceId)}/assets/${encodedAssetPath}`)
}

function isUnsafeAssetSegment(segment: string): boolean {
  return segment.length === 0 || segment === "." || segment === ".." || /[\\/\u0000]/u.test(segment)
}
