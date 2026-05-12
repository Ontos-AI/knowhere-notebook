import { headers } from "next/headers"

type RouteContext = {
  readonly cookieHeader: string
}

async function read(): Promise<RouteContext> {
  return {
    cookieHeader: (await headers()).get("cookie") ?? "",
  }
}

export const nextRouteContext = {
  read,
} as const
