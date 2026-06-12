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
    if (!knownRefs.has(artifact.ref)) {
      errors.push(`Artifact ref '${artifact.ref}' was not found in the evidence ledger.`)
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
