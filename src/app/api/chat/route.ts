import { NextResponse } from "next/server";

import { chatRouteService } from "@/domains/chat/route-service";

type RouteServiceResponse = {
  readonly status: number
  readonly body: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  const result = await chatRouteService.answerChat({
    body: await readJson(request),
  })

  return toNextResponse(result)
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function toNextResponse(result: RouteServiceResponse): NextResponse {
  return NextResponse.json(result.body, { status: result.status })
}
