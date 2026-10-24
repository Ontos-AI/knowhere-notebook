import type { NextResponse } from "next/server"
import { selectDemoSources } from "@/domains/demo/route-selection"

/** Compatibility metadata read for older clients; selection writes use /select. */
export function POST(request: Request): Promise<NextResponse> {
  return selectDemoSources(request, false)
}
