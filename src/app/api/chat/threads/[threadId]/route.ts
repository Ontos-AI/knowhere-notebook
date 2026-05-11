import { NextResponse, type NextRequest } from "next/server"

import { chatRouteService } from "@/domains/chat/route-service"

type RouteContext = {
  params: Promise<{
    threadId: string
  }>
}

type RouteServiceResponse = {
  readonly status: number
  readonly body: unknown
}

type ReadJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false }

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { threadId } = await context.params

  return toNextResponse(await chatRouteService.getThread({
    threadId,
  }))
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { threadId } = await context.params
  const body = await readJson(request)
  if (!body.ok) {
    return NextResponse.json(
      { message: "Invalid request body." },
      { status: 400 },
    )
  }

  return toNextResponse(await chatRouteService.archiveThread({
    threadId,
    body: body.value,
  }))
}

async function readJson(request: Request): Promise<ReadJsonResult> {
  try {
    return { ok: true, value: await request.json() }
  } catch {
    return { ok: false }
  }
}

function toNextResponse(result: RouteServiceResponse): NextResponse {
  return NextResponse.json(result.body, { status: result.status })
}
