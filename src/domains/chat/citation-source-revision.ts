import type { ChatSource } from "./contracts"

/** Bind an asset read to retrieval provenance instead of the latest catalog. */
export function bindCitationSourceRevision(
  source: ChatSource,
  reference: unknown,
  metadata?: Readonly<Record<string, unknown>>,
): ChatSource | null {
  const fields = isRecord(reference) ? reference : {}
  const namespace = getString(fields.namespace) ?? getString(metadata?.namespace)
  const jobResultId = getString(fields.jobResultId) ?? getString(metadata?.jobResultId)
  if (namespace && source.namespace && namespace !== source.namespace) return null
  if (source.namespace === "__knowhere_demo__" && !jobResultId) return null
  return {
    ...source,
    ...(namespace ? { namespace } : {}),
    ...(jobResultId ? { jobResultId, knowhereJobId: jobResultId } : {}),
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}
