import type {
  ContextPolicy,
  EvidenceLedgerSnapshot,
  HarnessToolCallTrace,
  IntentFrame,
  OutputCitation,
  OutputManifest,
} from "./types"

export type ManifestValidationInput = {
  readonly manifest: OutputManifest
  readonly intent?: IntentFrame
  readonly contextPolicy?: ContextPolicy
  readonly finalized?: boolean
  readonly ledger: EvidenceLedgerSnapshot
  readonly toolCalls?: readonly HarnessToolCallTrace[]
  readonly surface: "notebook_chat" | "typing_compose" | "typing_quick_ask"
}

export type ManifestValidationResult = {
  readonly ok: boolean
  readonly errors: readonly string[]
}

const citationSourceFields = [
  "documentId",
  "sourceFileName",
  "sectionPath",
] as const

type CitationSourceField = (typeof citationSourceFields)[number]
type EvidenceSource = EvidenceLedgerSnapshot["chunks"][number]["source"]

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
  validateImageInspectionClaims(input, errors)
  validateUnavailableImageContentClaims(input, errors)
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
  const sourcesByRef = new Map<string, EvidenceSource>([
    ...input.ledger.chunks.map(
      (chunk): readonly [string, EvidenceSource] => [chunk.ref, chunk.source],
    ),
    ...input.ledger.assets.map(
      (asset): readonly [string, EvidenceSource] => [asset.ref, asset.source],
    ),
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
      continue
    }

    const source = sourcesByRef.get(citation.ref)
    if (!source) continue
    validateCitationSource(
      {
        ref: citation.ref,
        declared: citation.source,
        resolved: source,
      },
      errors,
    )
  }
}

function validateCitationSource(
  input: {
    readonly ref: string
    readonly declared: OutputCitation["source"]
    readonly resolved: EvidenceSource
  },
  errors: string[],
): void {
  for (const field of citationSourceFields) {
    validateCitationSourceField(
      {
        ref: input.ref,
        field,
        declaredValue: input.declared[field],
        resolvedValue: input.resolved[field],
      },
      errors,
    )
  }
}

function validateCitationSourceField(
  input: {
    readonly ref: string
    readonly field: CitationSourceField
    readonly declaredValue: string | null | undefined
    readonly resolvedValue: string | null | undefined
  },
  errors: string[],
): void {
  const declaredValue = normalizeSourceValue(input.declaredValue)
  const resolvedValue = normalizeSourceValue(input.resolvedValue)
  if (declaredValue === resolvedValue) return

  errors.push(
    `Citation ref '${input.ref}' source.${input.field} must match resolved evidence source. Expected ${formatSourceValue(
      resolvedValue,
    )}, received ${formatSourceValue(declaredValue)}.`,
  )
}

function normalizeSourceValue(value: string | null | undefined): string | null {
  return value ?? null
}

function formatSourceValue(value: string | null): string {
  return value === null ? "missing" : `'${value}'`
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

function validateImageInspectionClaims(
  input: ManifestValidationInput,
  errors: string[],
): void {
  const claimText = [input.manifest.text, ...input.manifest.unresolved].join("\n")
  if (!mentionsImageInspectionResult(claimText)) return

  if (hasImageInspectionToolCall(input)) return

  errors.push(
    "Final output must not claim image/OCR inspection succeeded or failed unless inspectImage was called.",
  )
}

function validateUnavailableImageContentClaims(
  input: ManifestValidationInput,
  errors: string[],
): void {
  const hasImageAssets = input.ledger.assets.some((asset) => asset.type === "image")
  if (!hasImageAssets) return
  if (hasImageInspectionToolCall(input)) return

  const claimText = [input.manifest.text, ...input.manifest.unresolved].join("\n")
  if (!mentionsUnavailableImageContent(claimText)) return

  errors.push(
    "Final output must inspect available image assets before claiming retrieved page/image content cannot be read.",
  )
}

function hasImageInspectionToolCall(input: ManifestValidationInput): boolean {
  return input.toolCalls?.some((call) => call.tool === "inspectImage") === true
}

function mentionsImageInspectionResult(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return false

  return (
    /\b(?:image|visual)\s+(?:inspection|recognition|analysis)\s+(?:failed|did not|could not|was unable|found|showed|confirmed)/iu.test(
      normalized,
    ) ||
    /\bOCR\s+(?:failed|did not|could not|was unable|found|showed|confirmed|extracted)/iu.test(
      normalized,
    ) ||
    /(?:图像|图片|视觉).{0,8}(?:识别|检查|检视|查看|分析).{0,12}(?:未|没|无法|不能|不成功|失败|成功|显示|发现|提取|读取)/u.test(
      normalized,
    ) ||
    /(?:图像|图片|视觉).{0,12}(?:未|没|无法|不能|不成功|失败).{0,16}(?:识别|检查|检视|查看|分析|检测|提取|读取|获取)/u.test(
      normalized,
    ) ||
    /(?:未|没|无法|不能|不成功|失败).{0,12}(?:图像|图片|视觉|OCR).{0,12}(?:识别|检查|检视|查看|分析|检测|提取|读取|获取)/u.test(
      normalized,
    )
  )
}

function mentionsUnavailableImageContent(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return false

  return (
    /\b(?:cannot|can't|could not|unable to|was unable to|did not)\s+(?:directly\s+)?(?:read|inspect|access|extract|see|view)\b.{0,48}\b(?:page|image|visual|OCR|content|clause|details|text)\b/iu.test(
      normalized,
    ) ||
    /\b(?:page|image|visual|OCR|content|clause|details|text)\b.{0,48}\b(?:cannot|can't|could not|unable to|was unable to|did not)\s+(?:directly\s+)?(?:read|inspect|access|extract|see|view)\b/iu.test(
      normalized,
    ) ||
    /(?:无法|不能|未能|没法|没有办法).{0,8}(?:直接)?(?:读取|查看|识别|检测|提取|看清|访问|获取).{0,16}(?:页面|页|图片|图像|条款|内容|细节|文字)/u.test(
      normalized,
    ) ||
    /(?:页面|页|图片|图像|条款|内容|细节|文字).{0,16}(?:无法|不能|未能|没法|没有办法).{0,16}(?:直接)?(?:读取|查看|识别|检测|提取|看清|访问|获取)/u.test(
      normalized,
    )
  )
}
