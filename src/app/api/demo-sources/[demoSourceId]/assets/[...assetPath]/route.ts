import { knowhereDemoApi } from "@/integrations/knowhere-demo"

type RouteContext = {
  readonly params: Promise<{
    readonly demoSourceId: string
    readonly assetPath: string[]
  }>
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { assetPath, demoSourceId } = await context.params
  const encodedAssetPath = assetPath.map(encodeURIComponent).join("/")
  const response = await fetch(
    knowhereDemoApi.resolveApiURL(
      `/api/v1/demo/sources/${encodeURIComponent(
        demoSourceId,
      )}/assets/${encodedAssetPath}`,
    ),
    { cache: "no-store" },
  )

  if (!response.ok || !response.body) {
    return Response.json(
      { message: "Demo source asset not found." },
      { status: 404 },
    )
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
    },
  })
}
