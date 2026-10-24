import { proxyKnowhereDemoFile } from "@/integrations/knowhere-demo-file-proxy"

type RouteContext = { readonly params: Promise<{ readonly demoSourceId: string }> }

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { demoSourceId } = await context.params
  return proxyKnowhereDemoFile(request, `/api/v1/demo/sources/${encodeURIComponent(demoSourceId)}/original`)
}
