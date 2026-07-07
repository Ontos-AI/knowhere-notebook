import { Effect } from "effect"
import type { Knowledge } from "@ontos-ai/knowhere-sdk"

import type {
  KnowhereDocumentSummary,
  KnowhereToolRuntime,
} from "@/agent-harness"
import type { Source } from "@/infrastructure/db/schema"
import {
  listRemoteLibraryDocuments,
  type RemoteLibraryDocument,
} from "@/domains/sources/remote-library"
import type { SearchSources } from "./contracts"
import { excludeDocuments } from "./retrieval"

type RemoteDocumentClient = Parameters<
  typeof listRemoteLibraryDocuments
>[0]["client"]

export type NotebookKnowhereRemoteDocumentClient = RemoteDocumentClient

type NotebookKnowhereToolsInput = {
  readonly namespace: string
  readonly sources: readonly Source[]
  readonly excludedSourceIds: readonly string[]
  readonly searchSources: SearchSources
  readonly knowledge?: Knowledge
  readonly remoteDocumentClient?: RemoteDocumentClient
}

type SearchOnlyRuntimeInput = {
  readonly searchSources: SearchSources
}

export const notebookKnowhereTools = {
  createRuntime(input: NotebookKnowhereToolsInput): KnowhereToolRuntime {
    return {
      search: (request) => input.searchSources(request),
      listDocuments: async () => ({
        documents: await listVisibleDocuments(input),
      }),
      getDocumentOutline: async (request) => {
        const knowledge = requireKnowledge(input.knowledge)
        return knowledge.getDocumentOutline(request)
      },
      readChunks: async (request) => {
        const knowledge = requireKnowledge(input.knowledge)
        return knowledge.readChunks(request)
      },
      grepChunks: async (request) => {
        const knowledge = requireKnowledge(input.knowledge)
        return knowledge.grepChunks(request)
      },
    }
  },

  createSearchOnlyRuntime(input: SearchOnlyRuntimeInput): KnowhereToolRuntime {
    return {
      search: (request) => input.searchSources(request),
      listDocuments: async () => ({ documents: [] }),
      getDocumentOutline: async () => {
        throw new Error("Knowhere document outline is not configured.")
      },
      readChunks: async () => {
        throw new Error("Knowhere chunk reads are not configured.")
      },
      grepChunks: async () => {
        throw new Error("Knowhere grep is not configured.")
      },
    }
  },
} as const

async function listVisibleDocuments(
  input: NotebookKnowhereToolsInput,
): Promise<KnowhereDocumentSummary[]> {
  const excludedSourceIds = new Set(input.excludedSourceIds)
  const excludedDocumentIds = new Set(
    excludeDocuments(input.sources, input.excludedSourceIds)
      .excludeDocumentIds ?? [],
  )
  const localDocuments = input.sources
    .filter(
      (source): source is Source & { readonly knowhereDocumentId: string } =>
        source.status === "ready" &&
        Boolean(source.knowhereDocumentId) &&
        !excludedSourceIds.has(source.id) &&
        !excludedDocumentIds.has(source.knowhereDocumentId ?? ""),
    )
    .map((source): KnowhereDocumentSummary => ({
      documentId: source.knowhereDocumentId,
      revisionKey: source.knowhereJobId ?? undefined,
      namespace: input.namespace,
      sourceFileName: source.title,
      title: source.title,
      status: source.status,
    }))

  const remoteDocuments = await listVisibleRemoteDocuments({
    input,
    localDocuments,
    excludedDocumentIds,
  })

  return [...localDocuments, ...remoteDocuments]
}

async function listVisibleRemoteDocuments(input: {
  readonly input: NotebookKnowhereToolsInput
  readonly localDocuments: readonly KnowhereDocumentSummary[]
  readonly excludedDocumentIds: ReadonlySet<string>
}): Promise<KnowhereDocumentSummary[]> {
  if (!input.input.remoteDocumentClient) return []

  const localDocumentIds = new Set(
    input.localDocuments.flatMap((document): string[] =>
      document.documentId ? [document.documentId] : [],
    ),
  )
  const documents = await Effect.runPromise(
    listRemoteLibraryDocuments({
      workspace: { namespace: input.input.namespace },
      client: input.input.remoteDocumentClient,
      localSources: input.input.sources,
    }),
  )

  return documents
    .filter(
      (document) =>
        document.status === "ready" &&
        !localDocumentIds.has(document.documentId) &&
        !input.excludedDocumentIds.has(document.documentId),
    )
    .map(toRemoteDocumentSummary)
}

function toRemoteDocumentSummary(
  document: RemoteLibraryDocument,
): KnowhereDocumentSummary {
  return {
    documentId: document.documentId,
    revisionKey: document.revisionKey,
    namespace: document.namespace,
    sourceFileName:
      document.sourceFileName ?? document.title ?? document.documentId,
    title: document.title,
    status: document.status,
  }
}

function requireKnowledge(knowledge: Knowledge | undefined): Knowledge {
  if (knowledge) return knowledge
  throw new Error("Knowhere parsed-document reads are not configured.")
}
