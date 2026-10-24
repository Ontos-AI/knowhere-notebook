import type { NextResponse } from "next/server"
import { selectDemoSources } from "@/domains/demo/route-selection"

export function POST(request: Request): Promise<NextResponse> {
  return selectDemoSources(request, true)
}
