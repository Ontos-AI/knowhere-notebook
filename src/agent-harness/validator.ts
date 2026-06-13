import type {
  ContextPolicy,
  EvidenceLedgerSnapshot,
  IntentFrame,
  OutputManifest,
} from "./types"

export type ManifestValidationInput = {
  readonly manifest: OutputManifest
  readonly intent?: IntentFrame
  readonly contextPolicy?: ContextPolicy
  readonly finalized?: boolean
  readonly ledger: EvidenceLedgerSnapshot
  readonly surface: "notebook_chat" | "typing_compose" | "typing_quick_ask"
}

export type ManifestValidationResult = {
  readonly ok: boolean
  readonly errors: readonly string[]
}

export function validateOutputManifest(
  input: ManifestValidationInput,
): ManifestValidationResult {
  const errors: string[] = []
  const text = input.manifest.text.trim()

  if (!text && input.manifest.artifacts.every((artifact) => !artifact.display)) {
    errors.push("Final output must contain text or at least one displayed artifact.")
  }

  validateWorkflow(input, errors)
  validateArtifactRefs(input, errors)
  validateArtifactCounts(input, errors)
  validateGrounding(input, errors)
  validateTaskEvidence(input, errors)
  validateTypingText(input, errors)

  return {
    ok: errors.length === 0,
    errors,
  }
}

function validateWorkflow(
  input: ManifestValidationInput,
  errors: string[],
): void {
  if (input.finalized === false) {
    errors.push("Agent must call finalize to produce the output manifest.")
  }

  if (!input.intent) {
    errors.push("Agent must declare intent before finalizing.")
  }

  if (!input.contextPolicy) {
    errors.push("Agent must set context policy before finalizing.")
  }
}

function validateArtifactRefs(
  input: ManifestValidationInput,
  errors: string[],
): void {
  const knownRefs = new Set([
    ...input.ledger.chunks.map((chunk) => chunk.ref),
    ...input.ledger.assets.map((asset) => asset.ref),
  ])

  for (const artifact of input.manifest.artifacts) {
    if (artifact.type === "derived_table") {
      artifact.rows.forEach((row, index) => {
        if (row.length !== artifact.columns.length) {
          errors.push(
            `Derived table row ${index + 1} has ${row.length} cells but expected ${artifact.columns.length}.`,
          )
        }
      })

      for (const ref of artifact.sourceRefs) {
        if (!knownRefs.has(ref)) {
          errors.push(
            `Derived table source ref '${ref}' was not found in the evidence ledger.`,
          )
        }
      }
      continue
    }

    if (!knownRefs.has(artifact.ref)) {
      errors.push(
        `Artifact ref '${artifact.ref}' was not found in the evidence ledger.`,
      )
    }
  }

  for (const citation of input.manifest.citations) {
    if (!knownRefs.has(citation.ref)) {
      errors.push(`Citation ref '${citation.ref}' was not found in the evidence ledger.`)
    }
  }
}

function validateArtifactCounts(
  input: ManifestValidationInput,
  errors: string[],
): void {
  const displayedCount = input.manifest.artifacts.filter(
    (artifact) => artifact.display,
  ).length
  const desiredCount = input.intent?.constraints.desiredCount
  const maxCount = input.intent?.constraints.maxCount

  if (typeof desiredCount === "number" && displayedCount > desiredCount) {
    errors.push(
      `Displayed artifact count ${displayedCount} exceeds desired count ${desiredCount}.`,
    )
  }

  if (typeof maxCount === "number" && displayedCount > maxCount) {
    errors.push(
      `Displayed artifact count ${displayedCount} exceeds maximum count ${maxCount}.`,
    )
  }
}

function validateGrounding(
  input: ManifestValidationInput,
  errors: string[],
): void {
  if (input.intent?.groundingPolicy !== "must_use_sources") return

  const hasLedgerEvidence =
    input.ledger.chunks.length > 0 || input.ledger.evidenceText.length > 0
  const hasOutputEvidence =
    input.manifest.citations.length > 0 ||
    input.manifest.artifacts.some((artifact) => artifact.display)
  const hasUnresolved = input.manifest.unresolved.length > 0

  if (!hasLedgerEvidence && !hasUnresolved) {
    errors.push(
      "Grounded output requires evidence or an explicit unresolved reason.",
    )
  }

  if (hasLedgerEvidence && !hasOutputEvidence && !hasUnresolved) {
    errors.push(
      "Grounded output used evidence but did not cite or display any selected evidence.",
    )
  }
}

function validateTaskEvidence(
  input: ManifestValidationInput,
  errors: string[],
): void {
  if (input.intent?.groundingPolicy !== "must_use_sources") return
  if (input.manifest.unresolved.length > 0) return

  const refs = getOutputEvidenceRefs(input.manifest)

  if (input.intent.task === "compare" && refs.size < 2) {
    errors.push(
      "Compare outputs that must use sources require at least two evidence refs or an explicit unresolved reason.",
    )
  }

  if (input.intent.task === "summarize" && refs.size < 1) {
    errors.push(
      "Summaries that must use sources require at least one evidence ref or an explicit unresolved reason.",
    )
  }
}

function getOutputEvidenceRefs(manifest: OutputManifest): Set<string> {
  const refs = new Set<string>()

  for (const citation of manifest.citations) refs.add(citation.ref)

  for (const artifact of manifest.artifacts) {
    if (!artifact.display) continue
    if (artifact.type === "derived_table") {
      artifact.sourceRefs.forEach((ref) => refs.add(ref))
    } else {
      refs.add(artifact.ref)
    }
  }

  return refs
}

function validateTypingText(
  input: ManifestValidationInput,
  errors: string[],
): void {
  if (input.surface !== "typing_compose") return

  const text = input.manifest.text
  if (/```|^\s*#{1,6}\s|^\s*[-*]\s/m.test(text)) {
    errors.push("Typing compose output must be insertion-ready plain text.")
  }
}
