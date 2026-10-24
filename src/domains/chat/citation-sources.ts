import { demoView } from "@/domains/demo/view"
import { getCompatibleNamespaces } from "@/domains/sources/namespace"
import { toSourceView } from "@/domains/sources/view"
import type { Source } from "@/infrastructure/db/schema"
import type { SourceView } from "@/domains/sources/types"
import type { DemoCatalog } from "@/integrations/knowhere-demo"
import type { ChatMessageView } from "./types"

type CitationSourcesInput = {
  readonly messages: readonly ChatMessageView[]
  readonly sources: readonly Source[]
  readonly catalog: DemoCatalog | null
  readonly namespace: string
}

export function resolveCitationSources(input: CitationSourcesInput): SourceView[] {
  const citations = input.messages.flatMap((message) => [
    ...(message.citations ?? []),
    ...(message.artifacts ?? []).flatMap((artifact) => artifact.citation ? [artifact.citation] : []),
  ])
  const resolved = new Map<string, SourceView>()
  for (const citation of citations) {
    const reference = citation.source
    if (!reference.documentId) continue
    const localSource = input.sources.find((source) =>
      source.knowhereDocumentId === reference.documentId &&
      (!reference.namespace || getCompatibleNamespaces({ namespace: input.namespace }).includes(reference.namespace)),
    )
    const sharedSource = input.catalog?.sources.find((source) =>
      source.canonicalDocumentId === reference.documentId &&
      (!reference.namespace || source.namespace === reference.namespace),
    )
    const source = localSource
      ? { ...toSourceView(localSource), namespace: reference.namespace ?? input.namespace }
      : sharedSource ? demoView.toSourceView({ ...sharedSource, ...(reference.jobResultId ? { jobResultId: reference.jobResultId } : {}) }) : undefined
    if (!source) continue
    // A shared citation without an immutable revision cannot identify the
    // original evidence safely, even when its document is still in the catalog.
    if (!localSource && !reference.jobResultId && source.namespace) continue
    const view: SourceView = {
      ...source,
      ...(reference.jobResultId ? { jobResultId: reference.jobResultId } : {}),
    }
    resolved.set(JSON.stringify([view.id, view.namespace, view.jobResultId]), view)
  }
  return [...resolved.values()]
}
