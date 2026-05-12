import { NextResponse } from "next/server"

import type { RouteResult } from "./route-result"

function toNextResponse(result: RouteResult): NextResponse {
  return NextResponse.json(result.body, { status: result.status })
}

export const nextRouteResponse = {
  toNextResponse,
} as const
