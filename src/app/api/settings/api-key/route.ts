import { headers } from "next/headers"
import { NextResponse } from "next/server"

import { ensureApiKeyForWorkspace, getApiKeyStatus } from "@/lib/api-key-service"
import { requireUser } from "@/lib/auth"
import { ensureWorkspace } from "@/lib/workspace"

export async function GET(): Promise<NextResponse> {
  const user = await requireUser()
  const workspace = await ensureWorkspace(user.id)
  const status = await getApiKeyStatus(workspace.id)

  return NextResponse.json({ status })
}

export async function POST(): Promise<NextResponse> {
  const user = await requireUser()
  const workspace = await ensureWorkspace(user.id)
  const cookieHeader = (await headers()).get("cookie") ?? ""

  if (!cookieHeader) {
    return NextResponse.json(
      { message: "Not authenticated." },
      { status: 401 },
    )
  }

  try {
    await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
    return NextResponse.json({ status: "active" as const })
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to create API key.",
      },
      { status: 500 },
    )
  }
}
