import type { KnowhereToolRuntime } from "@/agent-harness"
import type { SearchSources } from "./contracts"
import type { Source } from "@/infrastructure/db/schema"

type NotebookKnowhereToolsInput = {
  readonly searchSources: SearchSources
  readonly sources: readonly Source[]
}

export const notebookKnowhereTools = {
  createRuntime(input: NotebookKnowhereToolsInput): KnowhereToolRuntime {
    const knownDocumentIds = new Set(
      input.sources.flatMap((source) =>
        source.knowhereDocumentId ? [source.knowhereDocumentId] : [],
      ),
    )
    return {
      search: async (request) => {
        const requestedIds = [
          ...(request.includeDocumentIds ?? []),
          ...(request.excludeDocumentIds ?? []),
        ]
        if (requestedIds.some((id) => !knownDocumentIds.has(id))) {
          throw new Error(
            "Document scope contains an unverified ID. Use document IDs from source context or prior search results; otherwise keep the document requirement in query so Knowhere can locate it.",
          )
        }
        const response = await input.searchSources(request)
        for (const result of response.results) {
          if (result.source.documentId) knownDocumentIds.add(result.source.documentId)
        }
        for (const ref of response.referencedChunks) {
          if (ref.documentId) knownDocumentIds.add(ref.documentId)
        }
        return response
      },
    }
  },
} as const
