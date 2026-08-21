import type { ImageHighlightBox, ImageInspectionHighlights } from "./types"

const MIN_BOX_SIZE = 0.01

export function normalizeImageInspectionHighlights(input: {
  readonly pages: readonly {
    readonly ref: string
    readonly regions: readonly {
      readonly x: number
      readonly y: number
      readonly w: number
      readonly h: number
    }[]
  }[]
  readonly allowedRefs: ReadonlySet<string>
}): ImageInspectionHighlights[] {
  const byRef = new Map<string, ImageHighlightBox[]>()

  for (const page of input.pages) {
    const ref = page.ref.trim()
    if (!ref || !input.allowedRefs.has(ref)) continue

    const regions = normalizeHighlightBoxes(page.regions)
    if (regions.length === 0) continue

    const existing = byRef.get(ref) ?? []
    byRef.set(ref, [...existing, ...regions])
  }

  return Array.from(byRef.entries()).map(([ref, regions]) => ({
    ref,
    regions,
  }))
}

/** Clamp/normalize boxes for persistence and reload paths. */
export function normalizeHighlightBoxes(
  regions: readonly {
    readonly x: number
    readonly y: number
    readonly w: number
    readonly h: number
  }[],
): ImageHighlightBox[] {
  return regions
    .map(clampHighlightBox)
    .filter((box): box is ImageHighlightBox => box !== null)
}

export function mergeImageInspectionHighlights(
  existing: readonly ImageInspectionHighlights[] | undefined,
  incoming: readonly ImageInspectionHighlights[] | undefined,
): ImageInspectionHighlights[] {
  const byRef = new Map<string, ImageHighlightBox[]>()

  for (const page of existing ?? []) {
    byRef.set(page.ref, [...page.regions])
  }
  for (const page of incoming ?? []) {
    // Latest inspect for a ref replaces prior regions for that ref.
    byRef.set(page.ref, [...page.regions])
  }

  return Array.from(byRef.entries()).map(([ref, regions]) => ({
    ref,
    regions,
  }))
}

function clampHighlightBox(input: {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}): ImageHighlightBox | null {
  if (
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y) ||
    !Number.isFinite(input.w) ||
    !Number.isFinite(input.h)
  ) {
    return null
  }

  const x1 = clamp01(Math.min(input.x, input.x + input.w))
  const y1 = clamp01(Math.min(input.y, input.y + input.h))
  const x2 = clamp01(Math.max(input.x, input.x + input.w))
  const y2 = clamp01(Math.max(input.y, input.y + input.h))
  const w = x2 - x1
  const h = y2 - y1
  if (w < MIN_BOX_SIZE || h < MIN_BOX_SIZE) return null

  return { x: round01(x1), y: round01(y1), w: round01(w), h: round01(h) }
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function round01(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
