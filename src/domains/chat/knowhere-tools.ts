import type { KnowhereToolRuntime } from "@/agent-harness"
import type { SearchSources } from "./contracts"

type NotebookKnowhereToolsInput = {
  readonly searchSources: SearchSources
}

export const notebookKnowhereTools = {
  createRuntime(input: NotebookKnowhereToolsInput): KnowhereToolRuntime {
    return {
      search: (request) => input.searchSources(request),
    }
  },
} as const
