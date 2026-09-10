import type {
  MemorySearchItem,
  MemorySearchRequest,
  MemorySearchResponse,
  MemoryToolRuntime,
} from "@/agent-harness"
import { DISTILL_DEDUP_CANDIDATES_PER_KIND } from "@/domains/memory/distill-config"
import { tokenizeMemoryText } from "@/domains/memory/search-index"
import { memoryService } from "@/domains/memory/service"
import { fluidMemoryKinds, isFluidMemoryKind } from "@/domains/memory/types"
import type { FluidMemoryItem } from "@/infrastructure/db/schema"

type NotebookMemoryToolsInput = {
  readonly workspaceId: string
}

export const notebookMemoryTools = {
  createRuntime(input: NotebookMemoryToolsInput): MemoryToolRuntime {
    return {
      search: (request) => searchWorkspaceMemory(input.workspaceId, request),
    }
  },
} as const

async function searchWorkspaceMemory(
  workspaceId: string,
  request: MemorySearchRequest,
): Promise<MemorySearchResponse> {
  const tokens = tokenizeMemoryText(request.query).map((entry) => entry.token)
  const kinds = request.kinds ?? fluidMemoryKinds
  const items: MemorySearchItem[] = []

  for (const kind of kinds) {
    const candidates = await memoryService.findDedupCandidates(
      workspaceId,
      kind,
      tokens,
      // Same per-kind cap as the existing findDedupCandidates caller.
      DISTILL_DEDUP_CANDIDATES_PER_KIND,
    )
    for (const candidate of candidates) {
      const item = toMemorySearchItem(candidate, items.length + 1)
      if (item) items.push(item)
    }
  }

  return {
    query: request.query,
    items,
  }
}

function toMemorySearchItem(
  item: FluidMemoryItem,
  index: number,
): MemorySearchItem | null {
  if (!isFluidMemoryKind(item.kind)) return null

  return {
    ref: `mem:${index}`,
    itemId: item.id,
    kind: item.kind,
    abstractL0: item.abstractL0,
    overviewL1: item.overviewL1,
  }
}
