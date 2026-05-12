import { knowhereDemoApi } from "@/integrations/knowhere-demo"

type RouteContext = {
  readonly params: Promise<{
    readonly demoSourceId: string
  }>
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { demoSourceId } = await context.params
  const response = await fetch(
    knowhereDemoApi.resolveApiURL(
      `/api/v1/demo/sources/${encodeURIComponent(demoSourceId)}/original`,
    ),
    { cache: "no-store" },
  )

  if (!response.ok || !response.body) {
    return Response.json(
      { message: "Demo original file not found." },
      { status: 404 },
    )
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/pdf",
      "cache-control": "public, max-age=3600",
    },
  })
}
