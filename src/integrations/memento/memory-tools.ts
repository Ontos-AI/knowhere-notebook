import "server-only"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import type {
  MemorySearchItem,
  MemorySearchKind,
  MemorySearchRequest,
  MemorySearchResponse,
  MemoryToolRuntime,
} from "@/agent-harness"
import { memorySearchKinds } from "@/agent-harness"
import { readMementoConfig } from "./config"

type MementoMemoryToolsInput = {
  readonly workspaceId: string
}

export const mementoMemoryTools = {
  createRuntime(input: MementoMemoryToolsInput): MemoryToolRuntime {
    return {
      search: (request) => searchWorkspaceMemory(input.workspaceId, request),
    }
  },
} as const

async function searchWorkspaceMemory(
  workspaceId: string,
  request: MemorySearchRequest,
): Promise<MemorySearchResponse> {
  const { baseUrl, serviceKey } = readMementoConfig()
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  })
  const client = new Client({
    name: "knowhere-notebook",
    version: "0.1.0",
  })
  await client.connect(transport)
  try {
    const result = await client.callTool({
      name: "memory_search",
      arguments: {
        workspaceId,
        query: request.query,
        ...(request.kinds ? { kinds: request.kinds } : {}),
      },
    })
    if (result.isError) {
      throw new Error("memento memory_search failed")
    }
    return parseMemorySearchResponse(result.structuredContent)
  } finally {
    await client.close()
  }
}

function parseMemorySearchResponse(value: unknown): MemorySearchResponse {
  if (!value || typeof value !== "object") {
    throw new Error("memento memory_search returned no structured content")
  }
  const record = value as Record<string, unknown>
  if (typeof record.query !== "string" || !Array.isArray(record.items)) {
    throw new Error("memento memory_search structured content is invalid")
  }
  return {
    query: record.query,
    items: record.items.map(parseMemorySearchItem),
  }
}

function parseMemorySearchItem(value: unknown): MemorySearchItem {
  if (!value || typeof value !== "object") {
    throw new Error("memento memory_search item is invalid")
  }
  const item = value as Record<string, unknown>
  if (
    typeof item.ref !== "string" ||
    typeof item.itemId !== "string" ||
    typeof item.text !== "string" ||
    !isMemorySearchKind(item.kind)
  ) {
    throw new Error("memento memory_search item is invalid")
  }
  return {
    ref: item.ref,
    itemId: item.itemId,
    kind: item.kind,
    text: item.text,
  }
}

function isMemorySearchKind(value: unknown): value is MemorySearchKind {
  return (
    typeof value === "string" &&
    (memorySearchKinds as readonly string[]).includes(value)
  )
}
